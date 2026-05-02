/**
 * Feishu/Lark channel plugin for Klaus.
 * Aligned with OpenClaw's extensions/feishu/src/ implementation.
 *
 * Features:
 * - WebSocket (default) and Webhook transport modes
 * - HTTP timeout + proxy support for SDK client
 * - Persistent dedup (memory + file-backed, 24h TTL)
 * - Message debouncing for rapid consecutive messages
 * - Full message content parsing (text, post/rich-text, interactive cards,
 *   merge_forward, image, file, audio, video, sticker, share)
 * - Bot identity probe via /open-apis/bot/v3/info
 * - Group session routing (group, group_sender, group_topic, group_topic_sender)
 * - Reply-in-thread support
 * - Access control policies (dmPolicy, groupPolicy, allowlist)
 * - Webhook signature verification
 * - Sender name resolution with TTL cache + permission error handling
 * - Mention normalization (HTML-escaped, bot mention stripping)
 * - Reply fallback for withdrawn/deleted messages
 * - Media download and local storage
 * - Proactive message delivery (for cron scheduler)
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import crypto from "node:crypto";
import { singleAccountConfig, type ChannelPlugin } from "./types.js";
import type { InboundMessage, MessageType, MediaFile } from "../message.js";
import type {
  FeishuConfig,
  FeishuMessageEvent,
  FeishuPermissionError,
} from "./feishu-types.js";
import { decryptCred } from "./channel-creds.js";
import {
  createFeishuClient,
  createFeishuWSClient,
  createEventDispatcher,
  probeBotIdentity,
} from "./feishu-client.js";
import {
  parseMessageContent,
  parseMergeForwardContent,
  parsePostContent,
  stripBotMention,
  isBotMentioned,
  normalizeMentions,
  resolveFeishuGroupSession,
} from "./feishu-content.js";
import {
  tryBeginProcessing,
  releaseProcessing,
  finalizeProcessing,
  warmupFromDisk,
} from "./feishu-dedup.js";
import {
  resolveGroupConfig,
  isGroupAllowed,
  isDmAllowed,
  resolveReplyPolicy,
} from "./feishu-policy.js";
import {
  sendTextMessage,
  sendCardMessage,
  sendMessage,
} from "./feishu-send.js";
import {
  downloadImage,
  downloadMessageResource,
  saveMediaToLocal,
} from "./feishu-media.js";

// ---------------------------------------------------------------------------
// Module-level state (bot identity, cached config for deliver)
// ---------------------------------------------------------------------------

let cachedConfig: FeishuConfig | undefined;
let botOpenId: string | undefined;
let botName: string | undefined;

// ---------------------------------------------------------------------------
// Sender name resolution (aligned with OpenClaw bot-sender-name.ts)
// ---------------------------------------------------------------------------

const SENDER_NAME_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SENDER_NAME_CACHE_MAX = 5_000;
const senderNameCache = new Map<string, { name: string; expireAt: number }>();
const IGNORED_PERMISSION_SCOPE_TOKENS = ["contact:contact.base:readonly"];
const FEISHU_SCOPE_CORRECTIONS: Record<string, string> = {
  "contact:contact.base:readonly": "contact:user.base:readonly",
};
const permissionErrorNotifiedAt = new Map<string, number>();
const PERMISSION_ERROR_COOLDOWN_MS = 5 * 60 * 1000;

function correctScopeInUrl(url: string): string {
  let corrected = url;
  for (const [wrong, right] of Object.entries(FEISHU_SCOPE_CORRECTIONS)) {
    corrected = corrected.replaceAll(encodeURIComponent(wrong), encodeURIComponent(right));
    corrected = corrected.replaceAll(wrong, right);
  }
  return corrected;
}

function extractPermissionError(err: unknown): FeishuPermissionError | null {
  if (!err || typeof err !== "object") return null;
  const axiosErr = err as { response?: { data?: unknown } };
  const data = axiosErr.response?.data;
  if (!data || typeof data !== "object") return null;
  const feishuErr = data as { code?: number; msg?: string };
  if (feishuErr.code !== 99991672) return null;
  const msg = feishuErr.msg ?? "";
  const urlMatch = msg.match(/https:\/\/[^\s,]+\/app\/[^\s,]+/);
  return {
    code: feishuErr.code,
    message: msg,
    grantUrl: urlMatch?.[0] ? correctScopeInUrl(urlMatch[0]) : undefined,
  };
}

function resolveSenderLookupIdType(senderId: string): "open_id" | "user_id" | "union_id" {
  const trimmed = senderId.trim();
  if (trimmed.startsWith("ou_")) return "open_id";
  if (trimmed.startsWith("on_")) return "union_id";
  return "user_id";
}

async function resolveSenderName(config: FeishuConfig, senderId: string): Promise<string | undefined> {
  if (config.resolveSenderNames === false) return undefined;

  const normalizedId = senderId.trim();
  if (!normalizedId) return undefined;

  const cached = senderNameCache.get(normalizedId);
  const now = Date.now();
  if (cached && cached.expireAt > now) return cached.name;

  try {
    const client = createFeishuClient(config);
    const userIdType = resolveSenderLookupIdType(normalizedId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await client.contact.user.get({
      path: { user_id: normalizedId },
      params: { user_id_type: userIdType },
    });
    const name: string | undefined =
      res?.data?.user?.name ||
      res?.data?.user?.display_name ||
      res?.data?.user?.nickname ||
      res?.data?.user?.en_name;

    if (name && typeof name === "string") {
      senderNameCache.set(normalizedId, { name, expireAt: now + SENDER_NAME_TTL_MS });
      // Evict expired entries when over cap
      if (senderNameCache.size > SENDER_NAME_CACHE_MAX) {
        for (const [k, v] of senderNameCache) {
          if (v.expireAt <= now) senderNameCache.delete(k);
        }
      }
      return name;
    }
    return undefined;
  } catch (err) {
    const permErr = extractPermissionError(err);
    if (permErr) {
      if (IGNORED_PERMISSION_SCOPE_TOKENS.some((t) => permErr.message.toLowerCase().includes(t))) {
        return undefined;
      }
      const now2 = Date.now();
      const lastNotified = permissionErrorNotifiedAt.get(config.appId) ?? 0;
      if (now2 - lastNotified > PERMISSION_ERROR_COOLDOWN_MS) {
        permissionErrorNotifiedAt.set(config.appId, now2);
        console.warn(
          `[Feishu] Permission error resolving sender name (code=${permErr.code}).` +
          (permErr.grantUrl ? ` Grant URL: ${permErr.grantUrl}` : ""),
        );
      }
      return undefined;
    }
    console.warn(`[Feishu] Failed to resolve sender name for ${normalizedId}:`, err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Message type mapping
// ---------------------------------------------------------------------------

function toMessageType(feishuType: string): MessageType {
  switch (feishuType) {
    case "text":
    case "post":
    case "interactive":
      return "text";
    case "image":
      return "image";
    case "file":
      return "file";
    case "audio":
      return "voice";
    case "video":
      return "video";
    case "sticker":
      return "emoji";
    default:
      return "text";
  }
}

// ---------------------------------------------------------------------------
// Media resolution from message
// ---------------------------------------------------------------------------

async function resolveMediaFiles(
  config: FeishuConfig,
  event: FeishuMessageEvent,
): Promise<MediaFile[] | undefined> {
  const { message } = event;
  const senderId = event.sender.sender_id.open_id || "unknown";
  const files: MediaFile[] = [];

  try {
    if (message.message_type === "image") {
      const parsed = JSON.parse(message.content);
      const imageKey = parsed.image_key;
      if (imageKey) {
        const result = await downloadImage({ config, imageKey });
        const path = await saveMediaToLocal({
          buffer: result.buffer,
          fileName: `${imageKey}.${result.contentType?.split("/")[1] || "png"}`,
          senderId,
        });
        files.push({ type: "image", path, fileName: imageKey });
      }
    } else if (message.message_type === "file") {
      const parsed = JSON.parse(message.content);
      const fileKey = parsed.file_key;
      const fileName = parsed.file_name || "file";
      if (fileKey) {
        const result = await downloadMessageResource({
          config,
          messageId: message.message_id,
          fileKey,
          type: "file",
        });
        const path = await saveMediaToLocal({
          buffer: result.buffer,
          fileName: result.fileName || fileName,
          senderId,
        });
        files.push({ type: "file", path, fileName: result.fileName || fileName });
      }
    } else if (message.message_type === "audio") {
      const parsed = JSON.parse(message.content);
      const fileKey = parsed.file_key;
      if (fileKey) {
        const result = await downloadMessageResource({
          config,
          messageId: message.message_id,
          fileKey,
          type: "file",
        });
        const path = await saveMediaToLocal({
          buffer: result.buffer,
          fileName: `audio-${Date.now()}.opus`,
          senderId,
        });
        files.push({ type: "audio", path });
      }
    } else if (message.message_type === "video") {
      const parsed = JSON.parse(message.content);
      const fileKey = parsed.file_key;
      if (fileKey) {
        const result = await downloadMessageResource({
          config,
          messageId: message.message_id,
          fileKey,
          type: "file",
        });
        const path = await saveMediaToLocal({
          buffer: result.buffer,
          fileName: `video-${Date.now()}.mp4`,
          senderId,
        });
        files.push({ type: "video", path });
      }
    } else if (message.message_type === "post") {
      const postResult = parsePostContent(message.content);
      for (const imageKey of postResult.imageKeys) {
        try {
          const result = await downloadImage({ config, imageKey });
          const path = await saveMediaToLocal({
            buffer: result.buffer,
            fileName: `${imageKey}.${result.contentType?.split("/")[1] || "png"}`,
            senderId,
          });
          files.push({ type: "image", path, fileName: imageKey });
        } catch (err) {
          console.warn(`[Feishu] Failed to download post image ${imageKey}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn(`[Feishu] Failed to resolve media for message ${message.message_id}:`, err);
  }

  return files.length > 0 ? files : undefined;
}

// ---------------------------------------------------------------------------
// Event → InboundMessage conversion
// ---------------------------------------------------------------------------

async function toInboundMessage(config: FeishuConfig, event: FeishuMessageEvent): Promise<InboundMessage> {
  const { sender, message } = event;
  const senderOpenId = sender.sender_id.open_id || sender.sender_id.user_id || "unknown";
  const isDirectMessage = message.chat_type === "p2p";

  let sessionKey: string;

  if (isDirectMessage) {
    sessionKey = `feishu:${senderOpenId}`;
  } else {
    const groupConfig = resolveGroupConfig({ config, groupId: message.chat_id });
    const session = resolveFeishuGroupSession({
      chatId: message.chat_id,
      senderOpenId,
      messageId: message.message_id,
      rootId: message.root_id,
      threadId: message.thread_id,
      groupSessionScope:
        groupConfig?.groupSessionScope ?? config.groupSessionScope,
      replyInThread:
        groupConfig?.replyInThread ?? config.replyInThread,
      topicSessionMode:
        groupConfig?.topicSessionMode ?? config.topicSessionMode,
    });
    sessionKey = `feishu:${session.peerId}`;
  }

  // Parse text content
  let text = parseMessageContent(message.content, message.message_type);

  // Handle merge_forward: fetch sub-messages via API
  if (message.message_type === "merge_forward") {
    try {
      const client = createFeishuClient(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await client.im.message.get({
        path: { message_id: message.message_id },
      });
      const items = resp?.data?.items;
      if (items) {
        text = parseMergeForwardContent(JSON.stringify(items));
      }
    } catch (err) {
      console.warn(`[Feishu] Failed to fetch merge_forward content:`, err);
    }
  }

  // Strip bot @mention in groups, normalize remaining mentions
  if (!isDirectMessage) {
    text = stripBotMention(text, message.mentions, botOpenId);
    text = normalizeMentions(text, message.mentions, botOpenId);
  }

  // Extract mention names (excluding bot)
  const mentions = message.mentions
    ?.filter((m) => m.id.open_id !== botOpenId)
    .map((m) => m.name);

  // Resolve sender name
  const senderName = await resolveSenderName(config, senderOpenId);

  // Resolve media files
  const media = await resolveMediaFiles(config, event);

  return {
    sessionKey,
    text,
    messageType: toMessageType(message.message_type),
    chatType: isDirectMessage ? "private" : "group",
    senderId: senderOpenId,
    senderName,
    mentions: mentions?.length ? mentions : undefined,
    media,
    timestamp: message.create_time ? parseInt(message.create_time, 10) : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Message debouncer (aligned with OpenClaw's inbound debouncer)
// ---------------------------------------------------------------------------

type DebouncedMessage = {
  event: FeishuMessageEvent;
  timer: ReturnType<typeof setTimeout>;
};

const debounceQueues = new Map<string, DebouncedMessage[]>();
const DEBOUNCE_MS = 300;

function debounceMessage(
  event: FeishuMessageEvent,
  dispatch: (events: FeishuMessageEvent[]) => Promise<void>,
): void {
  const chatId = event.message.chat_id;
  let queue = debounceQueues.get(chatId);

  if (!queue) {
    queue = [];
    debounceQueues.set(chatId, queue);
  }

  // Clear existing timers
  for (const entry of queue) {
    clearTimeout(entry.timer);
  }

  const timer = setTimeout(async () => {
    const currentQueue = debounceQueues.get(chatId);
    debounceQueues.delete(chatId);
    if (!currentQueue?.length) return;

    const events = currentQueue.map((e) => e.event);
    try {
      await dispatch(events);
    } catch (err) {
      for (const e of events) {
        releaseProcessing(e.message.message_id);
      }
      console.error(`[Feishu] Debounce flush error for chat ${chatId}:`, err);
    }
  }, DEBOUNCE_MS);

  queue.push({ event, timer });
}

// ---------------------------------------------------------------------------
// Webhook signature verification (aligned with OpenClaw monitor.transport.ts)
// ---------------------------------------------------------------------------

function isWebhookSignatureValid(params: {
  headers: Record<string, string | string[] | undefined>;
  payload: Record<string, unknown>;
  encryptKey?: string;
}): boolean {
  const encryptKey = params.encryptKey?.trim();
  if (!encryptKey) return true;

  const getHeader = (name: string): string | undefined => {
    const val = params.headers[name];
    return Array.isArray(val) ? val[0] : val;
  };

  const timestamp = getHeader("x-lark-request-timestamp");
  const nonce = getHeader("x-lark-request-nonce");
  const signature = getHeader("x-lark-signature");
  if (!timestamp || !nonce || !signature) return false;

  const computed = crypto
    .createHash("sha256")
    .update(timestamp + nonce + encryptKey + JSON.stringify(params.payload))
    .digest("hex");

  const computedBuf = Buffer.from(computed, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (computedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(computedBuf, signatureBuf);
}

// ---------------------------------------------------------------------------
// Transport: WebSocket
// ---------------------------------------------------------------------------

async function startWebSocket(config: FeishuConfig, eventDispatcher: Lark.EventDispatcher, signal: AbortSignal): Promise<void> {
  const wsClient = await createFeishuWSClient(config);

  return new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log("[Feishu] Shutting down WebSocket...");
      try { wsClient.close(); } catch { /* ignore */ }
      resolve();
    };
    if (signal.aborted) { shutdown(); return; }
    signal.addEventListener("abort", shutdown, { once: true });

    wsClient.start({ eventDispatcher });
    console.log("[Feishu] WebSocket client started");
  });
}

// ---------------------------------------------------------------------------
// Transport: Webhook (with signature verification + rate limiting)
// ---------------------------------------------------------------------------

async function startWebhook(config: FeishuConfig, eventDispatcher: Lark.EventDispatcher, signal: AbortSignal): Promise<void> {
  const http = await import("node:http");

  const port = config.webhookPort ?? 3000;
  const host = config.webhookHost ?? "127.0.0.1";
  const webhookPath = config.webhookPath ?? "/feishu/events";

  // Simple rate limiter: per-IP, 100 requests per 10 seconds
  const rateLimitWindow = 10_000;
  const rateLimitMax = 100;
  const RATE_LIMIT_MAP_MAX = 10_000;
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  const server = http.createServer((req, res) => {
    // Rate limiting
    const clientIp = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();

    if (rateLimitMap.size > RATE_LIMIT_MAP_MAX) {
      for (const [ip, entry] of rateLimitMap) {
        if (now >= entry.resetAt) rateLimitMap.delete(ip);
      }
    }

    let rl = rateLimitMap.get(clientIp);
    if (!rl || now >= rl.resetAt) {
      rl = { count: 0, resetAt: now + rateLimitWindow };
      rateLimitMap.set(clientIp, rl);
    }
    rl.count++;
    if (rl.count > rateLimitMax) {
      res.statusCode = 429;
      res.end("Too Many Requests");
      return;
    }

    if (req.url !== webhookPath || req.method !== "POST") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("json")) {
      res.statusCode = 415;
      res.end("Unsupported Media Type");
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1MB
    const BODY_TIMEOUT_MS = 10_000;
    let timedOut = false;

    const bodyTimer = setTimeout(() => {
      timedOut = true;
      res.statusCode = 408;
      res.end("Request Timeout");
      req.destroy();
    }, BODY_TIMEOUT_MS);

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });

    req.on("end", () => {
      clearTimeout(bodyTimer);
      if (timedOut) return;

      if (size > MAX_BODY) {
        res.statusCode = 413;
        res.end("Payload Too Large");
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        res.statusCode = 400;
        res.end("Invalid JSON");
        return;
      }

      // Signature verification
      if (!isWebhookSignatureValid({
        headers: req.headers as Record<string, string | string[] | undefined>,
        payload: body,
        encryptKey: config.encryptKey,
      })) {
        res.statusCode = 401;
        res.end("Invalid signature");
        return;
      }

      // URL verification challenge
      if (body.type === "url_verification") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ challenge: body.challenge }));
        return;
      }

      // Encrypted challenge
      const { isChallenge, challenge } = Lark.generateChallenge(body, {
        encryptKey: config.encryptKey ?? "",
      });
      if (isChallenge) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(challenge));
        return;
      }

      // Dispatch event
      void eventDispatcher.invoke(body).then((value) => {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
        }
      }).catch((err) => {
        console.error("[Feishu] Webhook handler error:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    });
  });

  return new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      console.log("[Feishu] Shutting down webhook server...");
      server.close();
      resolve();
    };
    if (signal.aborted) { shutdown(); return; }
    signal.addEventListener("abort", shutdown, { once: true });

    server.listen(port, host, () => {
      console.log(`[Feishu] Webhook server listening on ${host}:${port}${webhookPath}`);
    });
    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const feishuPlugin: ChannelPlugin<FeishuConfig> = {
  meta: {
    id: "feishu",
    label: "Feishu / Lark",
    description: "飞书/Lark 机器人，支持 WebSocket 和 Webhook 两种连接模式",
    order: 1,
    icon: "feishu",
    aliases: ["lark"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
    image: true,
    file: true,
    audio: true,
    video: true,
    mention: true,
    reply: true,
    threads: true,
    media: true,
  },

  configSchema: {
    fields: [
      { key: "app_id", type: "string", label: "App ID", required: true, placeholder: "cli_xxx" },
      { key: "app_secret", type: "secret", label: "App Secret", required: true },
    ],
    async probe(config) {
      const identity = await probeBotIdentity({ appId: config.app_id!, appSecret: config.app_secret! } as FeishuConfig, 10_000);
      if (!identity.botOpenId) return { ok: false, error: "Failed to connect. Check App ID and App Secret." };
      return { ok: true, meta: { bot_name: identity.botName ?? "", bot_open_id: identity.botOpenId } };
    },
    deleteKeys: ["bot_name", "bot_open_id", "owner_id"],
  },

  config: singleAccountConfig<FeishuConfig>("feishu", "app_id", async (store) => {
    const appId = await store.get("channel.feishu.app_id");
    const appSecret = decryptCred((await store.get("channel.feishu.app_secret")) ?? "");
    return appId && appSecret ? { appId, appSecret } as FeishuConfig : null;
  }),

  security: {
    resolveDmPolicy: (ctx) => {
      const config = ctx.config as FeishuConfig;
      const policy = config.dmPolicy ?? "pairing";
      if ((policy as string) === "disabled") return "deny";
      if (policy === "pairing" || policy === "open") return "allow";
      // allowlist mode
      return isDmAllowed({ dmPolicy: policy, allowFrom: config.allowFrom ?? [], senderId: ctx.senderId })
        ? "allow" : "deny";
    },
    resolveGroupPolicy: (ctx) => {
      const config = ctx.config as FeishuConfig;
      const groupConfig = resolveGroupConfig({ config, groupId: ctx.groupId ?? "" });
      const policy = config.groupPolicy ?? "allowlist";
      if (policy === "disabled" || groupConfig?.enabled === false) return "deny";
      if (policy === "open") return "allow";
      // allowlist mode
      const allowFrom = groupConfig?.allowFrom ?? config.groupSenderAllowFrom ?? config.groupAllowFrom ?? [];
      return isGroupAllowed({ groupPolicy: policy, allowFrom, senderId: ctx.senderId })
        ? "allow" : "deny";
    },
  },

  groups: {
    resolveRequireMention: (params) => {
      const config = params.config as FeishuConfig;
      const groupConfig = resolveGroupConfig({ config, groupId: params.groupId });
      const { requireMention } = resolveReplyPolicy({
        isDirectMessage: false,
        globalConfig: config,
        groupConfig,
      });
      return requireMention;
    },
  },

  mentions: {
    stripMentions: (text, ctx) => {
      let result = stripBotMention(text, ctx.mentions as any, ctx.botId);
      result = normalizeMentions(result, ctx.mentions as any, ctx.botId);
      return result;
    },
  },

  status: {
    async probeAccount(params) {
      const config = params.config as FeishuConfig;
      try {
        const identity = await probeBotIdentity(config);
        return identity.botOpenId ? { ok: true } : { ok: false, error: "Could not resolve bot identity" };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  messaging: {
    resolveOutboundSessionRoute(params) {
      const config = params.config as FeishuConfig;
      if (params.chatType === "direct") {
        return {
          sessionKey: `feishu:${params.senderId}`,
          chatType: "direct" as const,
          targetId: params.targetId,
        };
      }
      const session = resolveFeishuGroupSession({
        chatId: params.targetId,
        senderOpenId: params.senderId,
        messageId: "",
        rootId: undefined,
        threadId: params.threadId,
        groupSessionScope: config.groupSessionScope,
        replyInThread: config.replyInThread,
        topicSessionMode: config.topicSessionMode,
      });
      return {
        sessionKey: `feishu:${session.peerId}`,
        chatType: "group" as const,
        targetId: params.targetId,
        threadId: params.threadId,
      };
    },
  },

  allowlist: {
    readConfig(params) {
      const config = params.config as FeishuConfig;
      const scope = params.scope;
      if (scope === "dm") {
        return { entries: [...(config.allowFrom ?? [])], policy: config.dmPolicy ?? "pairing" };
      }
      return { entries: [...(config.groupAllowFrom ?? config.groupSenderAllowFrom ?? [])], policy: config.groupPolicy ?? "allowlist" };
    },
    supportsScope: () => true,
  },

  lifecycle: {
    async onAccountConfigChanged(params) {
      // Clear bot identity cache so next start re-probes
      botOpenId = undefined;
      botName = undefined;
      senderNameCache.clear();
    },
    async onAccountRemoved() {
      botOpenId = undefined;
      botName = undefined;
      cachedConfig = undefined;
      senderNameCache.clear();
      permissionErrorNotifiedAt.clear();
    },
  },

  threading: {
    resolveReplyToMode(params) {
      const config = params.config as FeishuConfig;
      const groupConfig = resolveGroupConfig({ config, groupId: params.groupId ?? "" });
      const mode = groupConfig?.replyInThread ?? config.replyInThread ?? "disabled";
      return mode === "enabled" ? "thread" : "reply";
    },
    resolveAutoThreadId(params) {
      return params.threadId?.trim() || params.rootId?.trim() || null;
    },
  },

  outbound: {
    deliveryMode: "gateway",
    chunkerMode: "markdown",
    async sendText(ctx, text) {
      const config = ctx.config as FeishuConfig;
      try {
        const renderMode = config.renderMode ?? "auto";
        const useCard = renderMode === "card" ||
          (renderMode === "auto" && /[*_`#\[\]|>~]/.test(text));
        const replyInThread = Boolean(ctx.threadId);

        if (useCard) {
          await sendCardMessage({
            config,
            chatId: ctx.targetId,
            markdown: text,
            replyToMessageId: ctx.replyToMessageId,
            replyInThread,
          });
        } else {
          await sendTextMessage({
            config,
            chatId: ctx.targetId,
            text,
            replyToMessageId: ctx.replyToMessageId,
            replyInThread,
          });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  gateway: {
    startAccount: async (ctx) => {
    const config = ctx.account;
    cachedConfig = config;
    const mode = config.connectionMode ?? "websocket";

    console.log(
      `[Feishu] Starting (mode=${mode}, domain=${config.domain ?? "feishu"})`,
    );

    // Warm up dedup cache from persistent storage
    const warmedUp = warmupFromDisk("global");
    if (warmedUp > 0) {
      console.log(`[Feishu] Dedup cache warmed up with ${warmedUp} entries`);
    }

    // Probe bot identity
    const identity = await probeBotIdentity(config);
    botOpenId = identity.botOpenId;
    botName = identity.botName;
    if (botOpenId) {
      ctx.setStatus({ connected: true, lastConnectedAt: Date.now(), name: botName, mode: config.connectionMode ?? "websocket", tokenStatus: "valid" });
      console.log(`[Feishu] Bot identity: ${botName ?? "unknown"} (${botOpenId})`);
    } else {
      console.warn("[Feishu] Could not resolve bot identity; @mention detection may not work");
    }

    // Create event dispatcher
    const eventDispatcher = createEventDispatcher(config);

    // Dispatch a batch of debounced messages
    const dispatchMessages = async (events: FeishuMessageEvent[]) => {
      const last = events[events.length - 1];
      if (!last) return;

      let effectiveEvent = last;
      if (events.length > 1) {
        const combinedText = events
          .map((e) => parseMessageContent(e.message.content, e.message.message_type))
          .filter(Boolean)
          .join("\n");
        if (combinedText.trim()) {
          effectiveEvent = {
            ...last,
            message: {
              ...last.message,
              message_type: "text",
              content: JSON.stringify({ text: combinedText }),
            },
          };
        }
      }

      try {
        const msg = await toInboundMessage(config, effectiveEvent);
        if (!msg.text.trim() && !msg.media?.length) return;

        if (msg.text.trim()) {
          ctx.setStatus({ lastInboundAt: Date.now() });
          await ctx.transcript(msg.sessionKey, "user", msg.text.trim());
          ctx.notify(msg.sessionKey, "user", msg.text.trim());
        }

        // Add typing indicator (emoji reaction) on the user's message
        let typingReactionId: string | null = null;
        if (config.typingIndicator !== false) {
          try {
            const client = createFeishuClient(config);
            const resp = await client.im.messageReaction.create({
              path: { message_id: effectiveEvent.message.message_id },
              data: { reaction_type: { emoji_type: "Typing" } },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typingReactionId = (resp as any)?.data?.reaction_id ?? null;
          } catch {
            // Non-critical
          }
        }

        const reply = await ctx.handler(msg);

        // Remove typing indicator
        if (typingReactionId) {
          try {
            const client = createFeishuClient(config);
            await client.im.messageReaction.delete({
              path: {
                message_id: effectiveEvent.message.message_id,
                reaction_id: typingReactionId,
              },
            });
          } catch { /* ignore */ }
        }

        if (reply) {
          await ctx.transcript(msg.sessionKey, "assistant", reply);
          ctx.notify(msg.sessionKey, "assistant", reply);
          ctx.setStatus({ lastOutboundAt: Date.now() });

          // Resolve reply-in-thread from config (per-group override or global)
          const groupConfig = resolveGroupConfig({ config, groupId: effectiveEvent.message.chat_id });
          const configReplyInThread =
            (groupConfig?.replyInThread ?? config.replyInThread ?? "disabled") === "enabled";
          const replyInThread = configReplyInThread ||
            Boolean(effectiveEvent.message.thread_id || effectiveEvent.message.root_id);

          if (ctx.sendOutbound) {
            await ctx.sendOutbound({
              sessionKey: msg.sessionKey,
              chatType: effectiveEvent.message.chat_type === "p2p" ? "direct" : "group",
              targetId: effectiveEvent.message.chat_id,
              text: reply,
              replyToMessageId: effectiveEvent.message.message_id,
              threadId: replyInThread ? (effectiveEvent.message.thread_id || effectiveEvent.message.root_id || effectiveEvent.message.message_id) : undefined,
            });
          } else {
            console.error("[Feishu] No outbound adapter — reply dropped");
          }
        }
      } catch (err) {
        console.error(`[Feishu] Error handling message:`, err);
      }

      // Finalize dedup for all events in batch
      for (const e of events) {
        await finalizeProcessing(e.message.message_id);
      }
    };

    // Register event handlers
    eventDispatcher.register({
      "im.message.receive_v1": async (data) => {
        const event = data as unknown as FeishuMessageEvent;
        const messageId = event.message?.message_id?.trim();
        if (!messageId) return;

        if (!tryBeginProcessing(messageId)) return;

        const senderOpenId = event.sender?.sender_id?.open_id;
        if (senderOpenId && senderOpenId === botOpenId) {
          releaseProcessing(messageId);
          return;
        }

        const isDirectMessage = event.message.chat_type === "p2p";

        // Access control
        if (isDirectMessage) {
          const dmPolicy = config.dmPolicy ?? "pairing";
          if ((dmPolicy as string) === "disabled") {
            releaseProcessing(messageId);
            return;
          }
          if (dmPolicy === "allowlist" && senderOpenId) {
            const allowed = isDmAllowed({
              dmPolicy,
              allowFrom: config.allowFrom ?? [],
              senderId: senderOpenId,
            });
            if (!allowed) {
              releaseProcessing(messageId);
              return;
            }
          }
        } else {
          const groupConfig = resolveGroupConfig({ config, groupId: event.message.chat_id });
          const groupPolicy = config.groupPolicy ?? "allowlist";

          if (groupPolicy === "disabled" || groupConfig?.enabled === false) {
            releaseProcessing(messageId);
            return;
          }

          if (groupPolicy === "allowlist" && senderOpenId) {
            const senderAllowFrom = config.groupSenderAllowFrom ?? config.groupAllowFrom ?? [];
            const allowed = isGroupAllowed({
              groupPolicy,
              allowFrom: groupConfig?.allowFrom ?? senderAllowFrom,
              senderId: senderOpenId,
            });
            if (!allowed) {
              releaseProcessing(messageId);
              return;
            }
          }

          const { requireMention } = resolveReplyPolicy({
            isDirectMessage: false,
            globalConfig: config,
            groupConfig,
          });
          if (requireMention && !isBotMentioned(event.message.mentions, botOpenId)) {
            releaseProcessing(messageId);
            return;
          }
        }

        debounceMessage(event, dispatchMessages);
      },

      "im.message.message_read_v1": async () => {
        // Ignore read receipts
      },

      "im.chat.member.bot.added_v1": async (data) => {
        try {
          const event = data as unknown as { chat_id: string };
          console.log(`[Feishu] Bot added to chat ${event.chat_id}`);
        } catch (err) {
          console.error("[Feishu] Error handling bot added event:", err);
        }
      },

      "im.chat.member.bot.deleted_v1": async (data) => {
        try {
          const event = data as unknown as { chat_id: string };
          console.log(`[Feishu] Bot removed from chat ${event.chat_id}`);
        } catch (err) {
          console.error("[Feishu] Error handling bot removed event:", err);
        }
      },
    });

    // Cleanup debounce timers and caches on shutdown
    ctx.signal.addEventListener("abort", () => {
      for (const [chatId, queue] of debounceQueues) {
        for (const entry of queue) {
          clearTimeout(entry.timer);
          releaseProcessing(entry.event.message.message_id);
        }
      }
      debounceQueues.clear();
      senderNameCache.clear();
      permissionErrorNotifiedAt.clear();
    }, { once: true });

    ctx.setStatus({ connected: false });

    // Start transport
    if (mode === "webhook") {
      await startWebhook(config, eventDispatcher, ctx.signal);
    } else {
      await startWebSocket(config, eventDispatcher, ctx.signal);
    }
    },
  },

  deliver: async (to: string, text: string) => {
    if (!cachedConfig) {
      console.warn("[Feishu] deliver() skipped: not configured");
      return;
    }
    await sendMessage({ config: cachedConfig, to, text });
  },
};
