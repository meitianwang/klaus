/**
 * Feishu (Lark) channel plugin.
 *
 * Supports both WebSocket (default, no public URL) and Webhook modes.
 * Uses @larksuiteoapi/node-sdk for event subscription and message APIs.
 *
 * Aligned with OpenClaw's Feishu extension patterns:
 * - Message deduplication (24h TTL, 1000 entries)
 * - Sender name resolution with 10-min TTL cache
 * - Rich text (post) parsing with full inline style support
 * - merge_forward / share_chat / interactive card parsing
 * - Domain support (feishu / lark / custom URL)
 * - Expanded retry error codes
 * - @mention placeholder replacement
 */

import * as http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadFeishuConfig } from "../config.js";
import type { InboundMessage, MediaFile } from "../message.js";
import { retryAsync } from "../retry.js";
import type { Handler } from "../types.js";
import type { ChannelPlugin } from "./types.js";

// ---------------------------------------------------------------------------
// Lazy SDK import (auto-install if missing, like QQ channel)
// ---------------------------------------------------------------------------

type LarkSDK = typeof import("@larksuiteoapi/node-sdk");
let Lark: LarkSDK | null = null;

async function ensureLarkSDK(): Promise<LarkSDK> {
  if (Lark) return Lark;
  try {
    Lark = await import("@larksuiteoapi/node-sdk");
    return Lark;
  } catch {
    console.log("[Feishu] @larksuiteoapi/node-sdk not found, installing...");
    const { execSync } = await import("node:child_process");
    execSync("npm install -g @larksuiteoapi/node-sdk", { stdio: "inherit" });
    Lark = await import("@larksuiteoapi/node-sdk");
    return Lark;
  }
}

// ---------------------------------------------------------------------------
// Domain resolution (aligned with OpenClaw's client.ts)
// ---------------------------------------------------------------------------

function resolveDomain(sdk: LarkSDK, domain: string | undefined): unknown {
  if (domain === "lark") return sdk.Domain.Lark;
  if (domain === "feishu" || !domain) return sdk.Domain.Feishu;
  return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}

// ---------------------------------------------------------------------------
// Types for Feishu event data
// ---------------------------------------------------------------------------

interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: Array<{
      id: { open_id?: string; user_id?: string };
      name: string;
      key: string; // e.g. @_user_1
    }>;
    root_id?: string;
    parent_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Message deduplication (aligned with OpenClaw's dedup.ts)
// Memory: 1000 entries, 24h TTL (fast path).
// Disk: ~/.klaus/feishu/dedup.json, 10000 entries, 24h TTL (survives restart).
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUP_MEM_MAX = 1000;
const DEDUP_DISK_MAX = 10000;
const dedupMap = new Map<string, number>();

const DEDUP_DIR = join(homedir(), ".klaus", "feishu");
const DEDUP_FILE = join(DEDUP_DIR, "dedup.json");

/** Load disk dedup state into memory on startup. */
function warmupDedupFromDisk(): void {
  try {
    if (!existsSync(DEDUP_FILE)) return;
    const raw = JSON.parse(readFileSync(DEDUP_FILE, "utf-8")) as Record<
      string,
      number
    >;
    const now = Date.now();
    for (const [id, ts] of Object.entries(raw)) {
      if (now - ts < DEDUP_TTL_MS) {
        dedupMap.set(id, ts);
      }
    }
  } catch {
    // Corrupted file — ignore, will be overwritten
  }
}

/** Persist dedup map to disk (best-effort, async-safe via sync write). */
function flushDedupToDisk(): void {
  try {
    const now = Date.now();
    const entries: Record<string, number> = {};
    let count = 0;
    for (const [id, ts] of dedupMap) {
      if (now - ts < DEDUP_TTL_MS) {
        entries[id] = ts;
        if (++count >= DEDUP_DISK_MAX) break;
      }
    }
    mkdirSync(DEDUP_DIR, { recursive: true });
    writeFileSync(DEDUP_FILE, JSON.stringify(entries), "utf-8");
  } catch {
    // Best-effort — don't crash on write failure
  }
}

// Periodic flush every 5 minutes
let dedupFlushTimer: ReturnType<typeof setInterval> | null = null;

function startDedupFlush(): void {
  if (dedupFlushTimer) return;
  dedupFlushTimer = setInterval(flushDedupToDisk, 5 * 60 * 1000);
  dedupFlushTimer.unref(); // Don't prevent process exit
}

function isDuplicate(messageId: string): boolean {
  const now = Date.now();

  // Prune expired entries when map is getting large
  if (dedupMap.size >= DEDUP_MEM_MAX) {
    for (const [key, ts] of dedupMap) {
      if (now - ts > DEDUP_TTL_MS) dedupMap.delete(key);
    }
  }

  if (dedupMap.has(messageId)) return true;
  dedupMap.set(messageId, now);
  return false;
}

// ---------------------------------------------------------------------------
// Sender name resolution with 10-min TTL cache
// (aligned with OpenClaw's bot.ts resolveSenderName)
// ---------------------------------------------------------------------------

const SENDER_CACHE_TTL_MS = 10 * 60 * 1000;
const senderNameCache = new Map<string, { name: string; expiresAt: number }>();

async function resolveSenderName(
  client: InstanceType<LarkSDK["Client"]>,
  senderId: string,
): Promise<string | undefined> {
  const cached = senderNameCache.get(senderId);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  try {
    // Infer user_id_type from prefix (aligned with OpenClaw)
    const userIdType = senderId.startsWith("ou_")
      ? "open_id"
      : senderId.startsWith("on_")
        ? "union_id"
        : "user_id";

    const resp = await client.contact.user.get({
      path: { user_id: senderId },
      params: { user_id_type: userIdType },
    });

    const user = (resp?.data as { user?: Record<string, string> })?.user;
    const name =
      user?.name || user?.display_name || user?.nickname || user?.en_name;

    if (name) {
      senderNameCache.set(senderId, {
        name,
        expiresAt: Date.now() + SENDER_CACHE_TTL_MS,
      });
      return name;
    }
  } catch (err) {
    // Permission errors are common; log once and continue
    const code = (err as { code?: number })?.code;
    if (code === 99991672) {
      console.warn(
        `[Feishu] No permission to resolve sender name for ${senderId}. ` +
          `Add contact:user.base:readonly scope.`,
      );
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Retryable error codes (aligned with OpenClaw)
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set([
  99991400, // rate limit
  99991403, // monthly quota exceeded
]);

function isRetryableError(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  if (code !== undefined && RETRYABLE_CODES.has(code)) return true;
  // HTTP 429
  const status = (err as { status?: number })?.status;
  return status === 429;
}

// ---------------------------------------------------------------------------
// Content parsing helpers
// ---------------------------------------------------------------------------

function parseTextContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Rich text (post) parsing — aligned with OpenClaw's post.ts
// Supports: text (bold/italic/strikethrough/code), links, @mentions,
// images, files, emotions, code blocks, hr, br
// ---------------------------------------------------------------------------

type PostParseResult = {
  textContent: string;
  imageKeys: string[];
  mediaKeys: Array<{ fileKey: string; fileName?: string }>;
  mentionedOpenIds: string[];
};

function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isBool(v: unknown): boolean {
  return v === true || v === 1 || v === "true";
}

// Markdown special character escaping (aligned with OpenClaw's post.ts)
const MD_SPECIAL = /([\\`*_{}\[\]()#+\-!|>~])/g;

function escapeMd(text: string): string {
  return text.replace(MD_SPECIAL, "\\$1");
}

/** Wrap text in inline code, choosing fence length to avoid collision. */
function wrapInlineCode(text: string): string {
  const maxRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(maxRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Sanitize code block language tag. */
function sanitizeLang(lang: string): string {
  return lang.trim().replace(/[^A-Za-z0-9_+#.\-]/g, "");
}

function renderPostElement(
  element: unknown,
  imageKeys: string[],
  mediaKeys: Array<{ fileKey: string; fileName?: string }>,
  mentionedOpenIds: string[],
): string {
  if (!isRecord(element)) return escapeMd(toStr(element));

  const tag = toStr(element.tag).toLowerCase();
  switch (tag) {
    case "text": {
      const text = toStr(element.text);
      const style = isRecord(element.style) ? element.style : undefined;

      if (style && isBool(style.code)) return wrapInlineCode(text);

      let rendered = escapeMd(text);
      if (!rendered) return "";
      if (style && isBool(style.bold)) rendered = `**${rendered}**`;
      if (style && isBool(style.italic)) rendered = `*${rendered}*`;
      if (style && isBool(style.underline)) rendered = `<u>${rendered}</u>`;
      if (
        style &&
        (isBool(style.strikethrough) ||
          isBool(style.line_through) ||
          isBool(style.lineThrough))
      )
        rendered = `~~${rendered}~~`;
      return rendered;
    }
    case "a": {
      const href = toStr(element.href).trim();
      const rawText = toStr(element.text);
      const text = rawText || href;
      if (!text) return "";
      if (!href) return escapeMd(text);
      return `[${escapeMd(text)}](${href})`;
    }
    case "at": {
      const openId = toStr(element.open_id) || toStr(element.user_id);
      if (openId) mentionedOpenIds.push(openId);
      const name =
        toStr(element.user_name) ||
        toStr(element.user_id) ||
        toStr(element.open_id);
      return name ? `@${escapeMd(name)}` : "";
    }
    case "img": {
      const imageKey = toStr(element.image_key);
      if (imageKey) imageKeys.push(imageKey);
      return "![image]";
    }
    case "media": {
      const fileKey = toStr(element.file_key);
      if (fileKey) {
        mediaKeys.push({
          fileKey,
          fileName: toStr(element.file_name) || undefined,
        });
      }
      return "[media]";
    }
    case "emotion":
      return escapeMd(
        toStr(element.emoji) ||
          toStr(element.text) ||
          toStr(element.emoji_type),
      );
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "code": {
      const code = toStr(element.text) || toStr(element.content);
      return code ? wrapInlineCode(code) : "";
    }
    case "code_block":
    case "pre": {
      const lang = sanitizeLang(toStr(element.language) || toStr(element.lang));
      const code = (toStr(element.text) || toStr(element.content)).replace(
        /\r\n/g,
        "\n",
      );
      const trail = code.endsWith("\n") ? "" : "\n";
      return `\`\`\`${lang}\n${code}${trail}\`\`\``;
    }
    default:
      return escapeMd(toStr(element.text));
  }
}

function parsePostContent(raw: string): PostParseResult {
  try {
    const parsed = JSON.parse(raw);
    // Resolve locale payload (aligned with OpenClaw's resolvePostPayload)
    let payload: { title?: string; content?: unknown[] } | null = null;

    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      payload = parsed as { title?: string; content: unknown[] };
    } else if (isRecord(parsed)) {
      // Try post.zh_cn / post.en_us or direct locale keys
      const post = isRecord(parsed.post) ? parsed.post : parsed;
      for (const val of Object.values(post)) {
        if (isRecord(val) && Array.isArray(val.content)) {
          payload = val as { title?: string; content: unknown[] };
          break;
        }
      }
    }

    if (!payload) {
      return {
        textContent: "[Rich text message]",
        imageKeys: [],
        mediaKeys: [],
        mentionedOpenIds: [],
      };
    }

    const imageKeys: string[] = [];
    const mediaKeys: Array<{ fileKey: string; fileName?: string }> = [];
    const mentionedOpenIds: string[] = [];
    const paragraphs: string[] = [];

    for (const paragraph of payload.content ?? []) {
      if (!Array.isArray(paragraph)) continue;
      let line = "";
      for (const el of paragraph) {
        line += renderPostElement(el, imageKeys, mediaKeys, mentionedOpenIds);
      }
      paragraphs.push(line);
    }

    const title = escapeMd(toStr(payload.title).trim());
    const body = paragraphs.join("\n").trim();
    const textContent = [title, body].filter(Boolean).join("\n\n").trim();

    return {
      textContent: textContent || "[Rich text message]",
      imageKeys,
      mediaKeys,
      mentionedOpenIds,
    };
  } catch {
    return {
      textContent: "[Rich text message]",
      imageKeys: [],
      mediaKeys: [],
      mentionedOpenIds: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Interactive card parsing (aligned with OpenClaw's send.ts)
// ---------------------------------------------------------------------------

function parseInteractiveContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return "[Interactive Card]";

    // Check body.elements (schema 2.0) or top-level elements
    const elements = Array.isArray(parsed.elements)
      ? parsed.elements
      : isRecord(parsed.body) && Array.isArray(parsed.body.elements)
        ? parsed.body.elements
        : null;

    if (!elements) return "[Interactive Card]";

    const texts: string[] = [];
    for (const el of elements) {
      if (!isRecord(el)) continue;
      if (
        el.tag === "div" &&
        isRecord(el.text) &&
        typeof el.text.content === "string"
      ) {
        texts.push(el.text.content);
      } else if (el.tag === "markdown" && typeof el.content === "string") {
        texts.push(el.content);
      }
    }
    return texts.join("\n").trim() || "[Interactive Card]";
  } catch {
    return "[Interactive Card]";
  }
}

// ---------------------------------------------------------------------------
// share_chat parsing
// ---------------------------------------------------------------------------

function parseShareChatContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      chat_id?: string;
      body?: string;
      summary?: string;
    };
    return (
      parsed.body ||
      parsed.summary ||
      `[Shared chat: ${parsed.chat_id ?? "unknown"}]`
    );
  } catch {
    return "[Shared chat]";
  }
}

// ---------------------------------------------------------------------------
// Image/file key parsing
// ---------------------------------------------------------------------------

function parseImageKey(raw: string): string | undefined {
  try {
    return (JSON.parse(raw) as { image_key?: string }).image_key;
  } catch {
    return undefined;
  }
}

function parseFileContent(raw: string): {
  fileKey?: string;
  fileName?: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      file_key?: string;
      file_name?: string;
    };
    return { fileKey: parsed.file_key, fileName: parsed.file_name };
  } catch {
    return {};
  }
}

function parseAudioKey(raw: string): string | undefined {
  try {
    return (JSON.parse(raw) as { file_key?: string }).file_key;
  } catch {
    return undefined;
  }
}

function parseVideoKey(raw: string): string | undefined {
  try {
    return (JSON.parse(raw) as { file_key?: string }).file_key;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Strip bot @mention from text + replace @_user_N placeholders
// (aligned with OpenClaw: replace non-bot mention placeholders with names)
// ---------------------------------------------------------------------------

function stripBotMention(
  text: string,
  mentions: FeishuMessageEvent["message"]["mentions"],
  botOpenId: string | undefined,
): { text: string; mentionedBot: boolean; otherMentions: string[] } {
  let mentionedBot = false;
  const otherMentions: string[] = [];
  let result = text;

  if (mentions) {
    for (const m of mentions) {
      if (m.id.open_id === botOpenId) {
        mentionedBot = true;
        result = result.replace(m.key, "").trim();
      } else {
        // Replace @_user_N placeholder with @name
        result = result.replace(m.key, `@${m.name}`);
        const uid = m.id.open_id ?? m.id.user_id ?? m.name;
        otherMentions.push(uid);
      }
    }
  }

  return { text: result, mentionedBot, otherMentions };
}

// ---------------------------------------------------------------------------
// Message chunking for send (Feishu text limit ~30000 chars)
// ---------------------------------------------------------------------------

const MAX_CHUNK_SIZE = 4000;

function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", MAX_CHUNK_SIZE);
    if (splitAt <= 0) splitAt = MAX_CHUNK_SIZE;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// SDK response to Buffer helper
// (aligned with OpenClaw — SDK may return Buffer, ArrayBuffer, or ReadableStream)
// ---------------------------------------------------------------------------

async function sdkResponseToBuffer(data: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  // ReadableStream / AsyncIterable
  if (
    data &&
    typeof (data as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of data as AsyncIterable<unknown>) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer),
      );
    }
    return Buffer.concat(chunks);
  }
  throw new Error("[Feishu] Unexpected SDK response type for media download");
}

// ---------------------------------------------------------------------------
// Download media from Feishu API
// ---------------------------------------------------------------------------

async function saveTempFile(buffer: Buffer, name: string): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(tmpdir(), "klaus-files");
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, `${Date.now()}-${name}`);
  writeFileSync(filepath, buffer);
  return filepath;
}

async function downloadFeishuImage(
  client: InstanceType<LarkSDK["Client"]>,
  messageId: string,
  imageKey: string,
): Promise<string | undefined> {
  try {
    const resp = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: "image" },
    });
    if (resp?.data) {
      const buffer = await sdkResponseToBuffer(resp.data);
      return saveTempFile(buffer, `${imageKey}.png`);
    }
  } catch (err) {
    console.error(`[Feishu] Failed to download image ${imageKey}:`, err);
  }
  return undefined;
}

async function downloadFeishuFile(
  client: InstanceType<LarkSDK["Client"]>,
  messageId: string,
  fileKey: string,
  fileName?: string,
): Promise<string | undefined> {
  try {
    const resp = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: "file" },
    });
    if (resp?.data) {
      const buffer = await sdkResponseToBuffer(resp.data);
      const safeName = fileName?.replace(/[^\w.\-]/g, "_") ?? fileKey;
      return saveTempFile(buffer, safeName);
    }
  } catch (err) {
    console.error(`[Feishu] Failed to download file ${fileKey}:`, err);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fetch merge_forward sub-messages (aligned with OpenClaw)
// ---------------------------------------------------------------------------

async function fetchMergeForwardContent(
  client: InstanceType<LarkSDK["Client"]>,
  raw: string,
): Promise<string> {
  try {
    const parsed = JSON.parse(raw) as { message_id_list?: string[] };
    const ids = parsed.message_id_list ?? [];
    if (ids.length === 0) return "[Forwarded messages (empty)]";

    const lines: string[] = ["[Forwarded messages]:"];
    // Fetch up to 50 sub-messages
    for (const id of ids.slice(0, 50)) {
      try {
        const resp = (await client.im.message.get({
          path: { message_id: id },
        })) as {
          code?: number;
          data?: {
            items?: Array<{
              msg_type?: string;
              body?: { content?: string };
            }>;
          };
        };

        const item = resp?.data?.items?.[0];
        if (!item) {
          lines.push(`  - [message ${id}]`);
          continue;
        }

        const msgType = item.msg_type ?? "text";
        const content = item.body?.content ?? "";

        if (msgType === "text") {
          lines.push(`  - ${parseTextContent(content)}`);
        } else if (msgType === "post") {
          lines.push(`  - ${parsePostContent(content).textContent}`);
        } else {
          lines.push(`  - [${msgType} message]`);
        }
      } catch {
        lines.push(`  - [message ${id}]`);
      }
    }

    if (ids.length > 50) {
      lines.push(`  ... and ${ids.length - 50} more`);
    }

    return lines.join("\n");
  } catch {
    return "[Forwarded messages]";
  }
}

// ---------------------------------------------------------------------------
// Fetch bot open_id (shared between WS and Webhook modes)
// ---------------------------------------------------------------------------

async function fetchBotOpenId(
  client: InstanceType<LarkSDK["Client"]>,
): Promise<string | undefined> {
  try {
    const botInfo = await client.bot.info();
    const openId = (botInfo?.data as { open_id?: string })?.open_id;
    console.log(`[Feishu] Bot open_id: ${openId ?? "unknown"}`);
    return openId;
  } catch (err) {
    console.warn("[Feishu] Failed to get bot info:", err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Build InboundMessage from Feishu event
// ---------------------------------------------------------------------------

async function buildInboundMessage(
  event: FeishuMessageEvent,
  client: InstanceType<LarkSDK["Client"]>,
  botOpenId: string | undefined,
): Promise<InboundMessage | null> {
  const msg = event.message;
  const senderId = event.sender.sender_id.open_id ?? "";

  // Ignore bot's own messages
  if (event.sender.sender_type === "app") return null;

  // Deduplication
  if (isDuplicate(msg.message_id)) return null;

  const sessionKey =
    msg.chat_type === "p2p"
      ? `feishu:${senderId}`
      : `feishu-group:${msg.chat_id}`;

  // Resolve sender name (async, best-effort)
  const senderName = await resolveSenderName(client, senderId);

  // Parse content based on message type
  let text = "";
  const media: MediaFile[] = [];
  let messageType: InboundMessage["messageType"] = "text";
  let mentionedBot = false;
  let otherMentions: string[] = [];

  switch (msg.message_type) {
    case "text": {
      const rawText = parseTextContent(msg.content);
      const stripped = stripBotMention(rawText, msg.mentions, botOpenId);
      text = stripped.text;
      mentionedBot = stripped.mentionedBot;
      otherMentions = stripped.otherMentions;
      break;
    }
    case "post": {
      const result = parsePostContent(msg.content);
      const stripped = stripBotMention(
        result.textContent,
        msg.mentions,
        botOpenId,
      );
      text = stripped.text;
      mentionedBot = stripped.mentionedBot;
      otherMentions = stripped.otherMentions;

      // Download embedded images from post
      for (const imageKey of result.imageKeys) {
        const path = await downloadFeishuImage(
          client,
          msg.message_id,
          imageKey,
        );
        media.push({ type: "image", path });
      }
      // Download embedded files from post
      for (const m of result.mediaKeys) {
        const path = await downloadFeishuFile(
          client,
          msg.message_id,
          m.fileKey,
          m.fileName,
        );
        media.push({ type: "file", path, fileName: m.fileName });
      }
      break;
    }
    case "image": {
      messageType = "image";
      const imageKey = parseImageKey(msg.content);
      if (imageKey) {
        const path = await downloadFeishuImage(
          client,
          msg.message_id,
          imageKey,
        );
        media.push({ type: "image", path });
      }
      break;
    }
    case "file": {
      messageType = "file";
      const { fileKey, fileName } = parseFileContent(msg.content);
      if (fileKey) {
        const path = await downloadFeishuFile(
          client,
          msg.message_id,
          fileKey,
          fileName,
        );
        media.push({ type: "file", path, fileName });
      }
      break;
    }
    case "audio": {
      messageType = "voice";
      const audioKey = parseAudioKey(msg.content);
      if (audioKey) {
        const path = await downloadFeishuFile(
          client,
          msg.message_id,
          audioKey,
          "audio.opus",
        );
        media.push({ type: "audio", path });
      }
      break;
    }
    case "video": {
      messageType = "file";
      const videoKey = parseVideoKey(msg.content);
      if (videoKey) {
        const path = await downloadFeishuFile(
          client,
          msg.message_id,
          videoKey,
          "video.mp4",
        );
        media.push({ type: "file", path, fileName: "video.mp4" });
      }
      break;
    }
    case "sticker": {
      messageType = "emoji";
      break;
    }
    case "merge_forward": {
      text = await fetchMergeForwardContent(client, msg.content);
      break;
    }
    case "share_chat": {
      text = parseShareChatContent(msg.content);
      break;
    }
    case "interactive": {
      text = parseInteractiveContent(msg.content);
      break;
    }
    default: {
      try {
        const parsed = JSON.parse(msg.content) as { text?: string };
        text = parsed.text ?? `[${msg.message_type} message]`;
      } catch {
        text = `[${msg.message_type} message]`;
      }
    }
  }

  // Group messages: require @mention of bot for all message types
  if (msg.chat_type === "group" && !mentionedBot) {
    return null;
  }

  return {
    sessionKey,
    text,
    messageType: media.length > 0 && text ? "mixed" : messageType,
    chatType: msg.chat_type === "p2p" ? "private" : "group",
    senderId,
    senderName,
    media: media.length > 0 ? media : undefined,
    mentions: otherMentions.length > 0 ? otherMentions : undefined,
    replyTo: msg.parent_id ? { messageId: msg.parent_id } : undefined,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Send reply via Feishu API (with withdrawn-message fallback)
// ---------------------------------------------------------------------------

const WITHDRAWN_REPLY_CODES = new Set([230011, 231003]);

async function sendReply(
  client: InstanceType<LarkSDK["Client"]>,
  messageId: string,
  chatId: string,
  text: string,
): Promise<void> {
  const chunks = chunkText(text);

  for (let i = 0; i < chunks.length; i++) {
    const content = JSON.stringify({ text: chunks[i] });

    await retryAsync(
      async () => {
        if (i === 0) {
          // Reply to original message
          try {
            await client.im.message.reply({
              path: { message_id: messageId },
              data: { msg_type: "text", content },
            });
            return;
          } catch (err: unknown) {
            // If reply fails (message withdrawn), fallback to send new message
            const code = (err as { code?: number })?.code;
            const msg = (err as { msg?: string })?.msg?.toLowerCase() ?? "";
            if (
              (code !== undefined && WITHDRAWN_REPLY_CODES.has(code)) ||
              msg.includes("withdrawn") ||
              msg.includes("not found")
            ) {
              console.warn(
                `[Feishu] Reply target withdrawn, sending to chat instead`,
              );
            } else {
              throw err;
            }
          }
        }

        // Send as new message to chat
        await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: "text",
            content,
          },
        });
      },
      {
        attempts: 3,
        shouldRetry: isRetryableError,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Proactive delivery (for cron results)
// ---------------------------------------------------------------------------

async function deliverMessage(
  client: InstanceType<LarkSDK["Client"]>,
  to: string,
  text: string,
): Promise<void> {
  const chunks = chunkText(text);

  let receiveIdType: "open_id" | "chat_id" = "open_id";
  if (to.startsWith("oc_")) {
    receiveIdType = "chat_id";
  } else if (to === "*") {
    console.warn("[Feishu] Broadcast delivery not supported, skipping");
    return;
  }

  for (const chunk of chunks) {
    await retryAsync(
      async () => {
        await client.im.message.create({
          params: { receive_id_type: receiveIdType },
          data: {
            receive_id: to,
            msg_type: "text",
            content: JSON.stringify({ text: chunk }),
          },
        });
      },
      {
        attempts: 3,
        shouldRetry: isRetryableError,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Register message handler (shared between WS and Webhook)
// ---------------------------------------------------------------------------

function registerMessageHandler(
  sdk: LarkSDK,
  eventDispatcher: InstanceType<LarkSDK["EventDispatcher"]>,
  client: InstanceType<LarkSDK["Client"]>,
  botOpenId: string | undefined,
  handler: Handler,
): void {
  eventDispatcher.register({
    "im.message.receive_v1": async (data: unknown) => {
      try {
        const event = data as FeishuMessageEvent;
        const msg = await buildInboundMessage(event, client, botOpenId);
        if (!msg) return;

        const reply = await handler(msg);
        if (reply) {
          await sendReply(
            client,
            event.message.message_id,
            event.message.chat_id,
            reply,
          );
        }
      } catch (err) {
        console.error("[Feishu] Error handling message:", err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Channel start: WebSocket mode
// ---------------------------------------------------------------------------

async function startWebSocket(
  sdk: LarkSDK,
  cfg: ReturnType<typeof loadFeishuConfig>,
  client: InstanceType<LarkSDK["Client"]>,
  handler: Handler,
): Promise<void> {
  const botOpenId = await fetchBotOpenId(client);

  const eventDispatcher = new sdk.EventDispatcher({});
  registerMessageHandler(sdk, eventDispatcher, client, botOpenId, handler);

  const wsClient = new sdk.WSClient({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    domain: resolveDomain(sdk, cfg.domain) as string,
    loggerLevel: sdk.LoggerLevel.info,
  });

  console.log("[Feishu] Starting WebSocket connection...");
  await wsClient.start({ eventDispatcher });
  console.log("[Feishu] WebSocket client started");

  // Block forever
  await new Promise<void>(() => {});
}

// ---------------------------------------------------------------------------
// Channel start: Webhook mode
// ---------------------------------------------------------------------------

const WEBHOOK_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// Webhook rate limiting (aligned with OpenClaw: 120 req/min per IP)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

async function startWebhook(
  sdk: LarkSDK,
  cfg: ReturnType<typeof loadFeishuConfig>,
  client: InstanceType<LarkSDK["Client"]>,
  handler: Handler,
): Promise<void> {
  const botOpenId = await fetchBotOpenId(client);

  if (!cfg.encryptKey && !cfg.verificationToken) {
    console.warn(
      "[Feishu] WARNING: Webhook running without encryption/verification. " +
        "Set encrypt_key and verification_token for security.",
    );
  }

  const eventDispatcher = new sdk.EventDispatcher({
    encryptKey: cfg.encryptKey ?? "",
    verificationToken: cfg.verificationToken ?? "",
  });
  registerMessageHandler(sdk, eventDispatcher, client, botOpenId, handler);

  const webhookPath = "/feishu/events";
  const webhookHandler = sdk.adaptDefault(webhookPath, eventDispatcher, {
    autoChallenge: true,
  });

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith(webhookPath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Rate limit per IP (120 req/min, aligned with OpenClaw)
    const ip = req.socket.remoteAddress ?? "unknown";
    if (isRateLimited(ip)) {
      res.writeHead(429);
      res.end("Too Many Requests");
      return;
    }

    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(415);
      res.end("Unsupported Media Type");
      return;
    }

    // Body size guard — reject oversized payloads to prevent OOM
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > WEBHOOK_MAX_BODY_BYTES) {
      res.writeHead(413);
      res.end("Payload Too Large");
      return;
    }

    void Promise.resolve(webhookHandler(req, res)).catch((err) => {
      console.error("[Feishu] Webhook handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });
  });

  return new Promise<void>((resolve, reject) => {
    server.listen(cfg.port, "0.0.0.0", () => {
      console.log(
        `[Feishu] Webhook server listening on 0.0.0.0:${cfg.port}${webhookPath}`,
      );
    });
    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const feishuPlugin: ChannelPlugin = {
  meta: {
    id: "feishu",
    label: "Feishu / Lark",
    description: "Feishu (飞书/Lark) bot via WebSocket or Webhook",
  },

  capabilities: {
    dm: true,
    group: true,
    image: true,
    file: true,
    audio: true,
    reply: true,
    mention: true,
  },

  start: async (handler: Handler): Promise<void> => {
    const cfg = loadFeishuConfig();
    if (!cfg.appId || !cfg.appSecret) {
      throw new Error(
        "[Feishu] Missing app_id or app_secret. Run: klaus setup",
      );
    }

    // Warm up dedup from disk and start periodic flush
    warmupDedupFromDisk();
    startDedupFlush();

    const sdk = await ensureLarkSDK();

    const client = new sdk.Client({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      appType: sdk.AppType.SelfBuild,
      domain: resolveDomain(sdk, cfg.domain) as string,
    });

    if (cfg.mode === "webhook") {
      await startWebhook(sdk, cfg, client, handler);
    } else {
      await startWebSocket(sdk, cfg, client, handler);
    }
  },

  deliver: async (to: string, text: string): Promise<void> => {
    const cfg = loadFeishuConfig();
    if (!cfg.appId || !cfg.appSecret) return;

    const sdk = await ensureLarkSDK();
    const client = new sdk.Client({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      appType: sdk.AppType.SelfBuild,
      domain: resolveDomain(sdk, cfg.domain) as string,
    });

    await deliverMessage(client, to, text);
  },
};
