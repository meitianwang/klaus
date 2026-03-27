/**
 * Feishu message content parsing.
 * Aligned with OpenClaw's bot-content.ts + post.ts
 *
 * Handles: text, post (rich text), interactive (card), image, file, audio,
 * video, sticker, share_chat, share_user, merge_forward.
 */

import type {
  FeishuMention,
  FeishuMessageEvent,
  GroupSessionScope,
} from "./feishu-types.js";

// ---------------------------------------------------------------------------
// Post content parsing (aligned with OpenClaw post.ts)
// ---------------------------------------------------------------------------

const FALLBACK_POST_TEXT = "[Rich text message]";
const MARKDOWN_SPECIAL_CHARS = /([\\`*_{}\[\]()#+\-!|>~])/g;

type PostParseResult = {
  textContent: string;
  imageKeys: string[];
  mediaKeys: Array<{ fileKey: string; fileName?: string }>;
  mentionedOpenIds: string[];
};

type PostPayload = {
  title: string;
  content: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeMarkdownText(text: string): string {
  return text.replace(MARKDOWN_SPECIAL_CHARS, "\\$1");
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function isStyleEnabled(style: Record<string, unknown> | undefined, key: string): boolean {
  return style ? toBoolean(style[key]) : false;
}

function wrapInlineCode(text: string): string {
  const maxRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(maxRun + 1);
  const needsPadding = text.startsWith("`") || text.endsWith("`");
  const body = needsPadding ? ` ${text} ` : text;
  return `${fence}${body}${fence}`;
}

function sanitizeFenceLanguage(language: string): string {
  return language.trim().replace(/[^A-Za-z0-9_+#.-]/g, "");
}

function renderTextElement(element: Record<string, unknown>): string {
  const text = toStringOrEmpty(element.text);
  const style = isRecord(element.style) ? element.style : undefined;

  if (isStyleEnabled(style, "code")) {
    return wrapInlineCode(text);
  }

  let rendered = escapeMarkdownText(text);
  if (!rendered) return "";

  if (isStyleEnabled(style, "bold")) rendered = `**${rendered}**`;
  if (isStyleEnabled(style, "italic")) rendered = `*${rendered}*`;
  if (isStyleEnabled(style, "underline")) rendered = `<u>${rendered}</u>`;
  if (
    isStyleEnabled(style, "strikethrough") ||
    isStyleEnabled(style, "line_through") ||
    isStyleEnabled(style, "lineThrough")
  ) {
    rendered = `~~${rendered}~~`;
  }
  return rendered;
}

function renderLinkElement(element: Record<string, unknown>): string {
  const href = toStringOrEmpty(element.href).trim();
  const rawText = toStringOrEmpty(element.text);
  const text = rawText || href;
  if (!text) return "";
  if (!href) return escapeMarkdownText(text);
  return `[${escapeMarkdownText(text)}](${href})`;
}

function renderMentionElement(element: Record<string, unknown>): string {
  const mention =
    toStringOrEmpty(element.user_name) ||
    toStringOrEmpty(element.user_id) ||
    toStringOrEmpty(element.open_id);
  if (!mention) return "";
  return `@${escapeMarkdownText(mention)}`;
}

function renderEmotionElement(element: Record<string, unknown>): string {
  const text =
    toStringOrEmpty(element.emoji) ||
    toStringOrEmpty(element.text) ||
    toStringOrEmpty(element.emoji_type);
  return escapeMarkdownText(text);
}

function renderCodeBlockElement(element: Record<string, unknown>): string {
  const language = sanitizeFenceLanguage(
    toStringOrEmpty(element.language) || toStringOrEmpty(element.lang),
  );
  const code = (toStringOrEmpty(element.text) || toStringOrEmpty(element.content)).replace(
    /\r\n/g,
    "\n",
  );
  const trailingNewline = code.endsWith("\n") ? "" : "\n";
  return `\`\`\`${language}\n${code}${trailingNewline}\`\`\``;
}

function renderElement(
  element: unknown,
  imageKeys: string[],
  mediaKeys: Array<{ fileKey: string; fileName?: string }>,
  mentionedOpenIds: string[],
): string {
  if (!isRecord(element)) {
    return escapeMarkdownText(toStringOrEmpty(element));
  }

  const tag = toStringOrEmpty(element.tag).toLowerCase();
  switch (tag) {
    case "text":
      return renderTextElement(element);
    case "a":
      return renderLinkElement(element);
    case "at": {
      const mentioned =
        toStringOrEmpty(element.open_id) || toStringOrEmpty(element.user_id);
      if (mentioned) mentionedOpenIds.push(mentioned);
      return renderMentionElement(element);
    }
    case "img": {
      const imageKey = toStringOrEmpty(element.image_key);
      if (imageKey) imageKeys.push(imageKey);
      return "![image]";
    }
    case "media": {
      const fileKey = toStringOrEmpty(element.file_key);
      if (fileKey) {
        const fileName = toStringOrEmpty(element.file_name) || undefined;
        mediaKeys.push({ fileKey, fileName });
      }
      return "[media]";
    }
    case "emotion":
      return renderEmotionElement(element);
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "code": {
      const code = toStringOrEmpty(element.text) || toStringOrEmpty(element.content);
      return code ? wrapInlineCode(code) : "";
    }
    case "code_block":
    case "pre":
      return renderCodeBlockElement(element);
    default:
      return escapeMarkdownText(toStringOrEmpty(element.text));
  }
}

function toPostPayload(candidate: unknown): PostPayload | null {
  if (!isRecord(candidate) || !Array.isArray(candidate.content)) return null;
  return { title: toStringOrEmpty(candidate.title), content: candidate.content };
}

function resolveLocalePayload(candidate: unknown): PostPayload | null {
  const direct = toPostPayload(candidate);
  if (direct) return direct;
  if (!isRecord(candidate)) return null;
  for (const value of Object.values(candidate)) {
    const localePayload = toPostPayload(value);
    if (localePayload) return localePayload;
  }
  return null;
}

function resolvePostPayload(parsed: unknown): PostPayload | null {
  const direct = toPostPayload(parsed);
  if (direct) return direct;
  if (!isRecord(parsed)) return null;
  const wrappedPost = resolveLocalePayload(parsed.post);
  if (wrappedPost) return wrappedPost;
  return resolveLocalePayload(parsed);
}

export function parsePostContent(content: string): PostParseResult {
  try {
    const parsed = JSON.parse(content);
    const payload = resolvePostPayload(parsed);
    if (!payload) {
      return { textContent: FALLBACK_POST_TEXT, imageKeys: [], mediaKeys: [], mentionedOpenIds: [] };
    }

    const imageKeys: string[] = [];
    const mediaKeys: Array<{ fileKey: string; fileName?: string }> = [];
    const mentionedOpenIds: string[] = [];
    const paragraphs: string[] = [];

    for (const paragraph of payload.content) {
      if (!Array.isArray(paragraph)) continue;
      let renderedParagraph = "";
      for (const element of paragraph) {
        renderedParagraph += renderElement(element, imageKeys, mediaKeys, mentionedOpenIds);
      }
      paragraphs.push(renderedParagraph);
    }

    const title = escapeMarkdownText(payload.title.trim());
    const body = paragraphs.join("\n").trim();
    const textContent = [title, body].filter(Boolean).join("\n\n").trim();

    return {
      textContent: textContent || FALLBACK_POST_TEXT,
      imageKeys,
      mediaKeys,
      mentionedOpenIds,
    };
  } catch {
    return { textContent: FALLBACK_POST_TEXT, imageKeys: [], mediaKeys: [], mentionedOpenIds: [] };
  }
}

// ---------------------------------------------------------------------------
// Interactive card content parsing
// ---------------------------------------------------------------------------

function parseInteractiveContent(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "[Interactive Card]";

  const candidate = parsed as { elements?: unknown[]; body?: { elements?: unknown[] } };
  const elements = Array.isArray(candidate.elements)
    ? candidate.elements
    : Array.isArray(candidate.body?.elements)
      ? candidate.body!.elements
      : null;
  if (!elements) return "[Interactive Card]";

  const texts: string[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const item = element as { tag?: string; content?: string; text?: { content?: string } };
    if (item.tag === "div" && typeof item.text?.content === "string") {
      texts.push(item.text.content);
    } else if (item.tag === "markdown" && typeof item.content === "string") {
      texts.push(item.content);
    }
  }
  return texts.join("\n").trim() || "[Interactive Card]";
}

// ---------------------------------------------------------------------------
// Merge forward content parsing
// ---------------------------------------------------------------------------

function formatSubMessageContent(content: string, contentType: string): string {
  try {
    const parsed = JSON.parse(content);
    switch (contentType) {
      case "text":
        return parsed.text || content;
      case "post":
        return parsePostContent(content).textContent;
      case "image":
        return "[Image]";
      case "file":
        return `[File: ${parsed.file_name || "unknown"}]`;
      case "audio":
        return "[Audio]";
      case "video":
        return "[Video]";
      case "sticker":
        return "[Sticker]";
      case "merge_forward":
        return "[Nested Merged Forward]";
      default:
        return `[${contentType}]`;
    }
  } catch {
    return content;
  }
}

export function parseMergeForwardContent(content: string): string {
  const maxMessages = 50;

  let items: Array<{
    message_id?: string;
    msg_type?: string;
    body?: { content?: string };
    sender?: { id?: string };
    upper_message_id?: string;
    create_time?: string;
  }>;
  try {
    items = JSON.parse(content);
  } catch {
    return "[Merged and Forwarded Message - parse error]";
  }
  if (!Array.isArray(items) || items.length === 0) {
    return "[Merged and Forwarded Message - no sub-messages]";
  }
  const subMessages = items.filter((item) => item.upper_message_id);
  if (subMessages.length === 0) {
    return "[Merged and Forwarded Message - no sub-messages found]";
  }

  subMessages.sort(
    (a, b) => parseInt(a.create_time || "0", 10) - parseInt(b.create_time || "0", 10),
  );

  const lines = ["[Merged and Forwarded Messages]"];
  for (const item of subMessages.slice(0, maxMessages)) {
    lines.push(`- ${formatSubMessageContent(item.body?.content || "", item.msg_type || "text")}`);
  }
  if (subMessages.length > maxMessages) {
    lines.push(`... and ${subMessages.length - maxMessages} more messages`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Top-level message content parser
// ---------------------------------------------------------------------------

export function parseMessageContent(content: string, messageType: string): string {
  if (messageType === "post") {
    return parsePostContent(content).textContent;
  }

  try {
    const parsed = JSON.parse(content);

    if (messageType === "text") {
      return (parsed.text as string) || "";
    }
    if (messageType === "share_chat") {
      if (parsed && typeof parsed === "object") {
        const share = parsed as { body?: unknown; summary?: unknown; share_chat_id?: unknown };
        if (typeof share.body === "string" && (share.body as string).trim()) {
          return (share.body as string).trim();
        }
        if (typeof share.summary === "string" && (share.summary as string).trim()) {
          return (share.summary as string).trim();
        }
        if (typeof share.share_chat_id === "string") {
          return `[Forwarded message: ${share.share_chat_id}]`;
        }
      }
      return "[Forwarded message]";
    }
    if (messageType === "merge_forward") {
      return "[Merged and Forwarded Message - loading...]";
    }
    if (messageType === "image") return "[图片]";
    if (messageType === "file") return `[文件: ${(parsed.file_name as string) || "未知"}]`;
    if (messageType === "audio") return "[语音]";
    if (messageType === "video") return "[视频]";
    if (messageType === "sticker") return "[表情]";
    if (messageType === "share_user") return "[分享名片]";
    if (messageType === "interactive") return parseInteractiveContent(parsed);

    return content;
  } catch {
    return content;
  }
}

// ---------------------------------------------------------------------------
// Bot mention detection & stripping
// ---------------------------------------------------------------------------

/**
 * Strip bot @mention placeholder from message text.
 */
export function stripBotMention(
  text: string,
  mentions: FeishuMention[] | undefined,
  botOpenId: string | undefined,
): string {
  if (!mentions?.length || !botOpenId) return text;
  for (const m of mentions) {
    if (m.id.open_id === botOpenId) {
      text = text.replace(
        new RegExp(m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "",
      ).trim();
    }
  }
  return text;
}

/**
 * Check if bot was @mentioned in the message.
 */
export function isBotMentioned(
  mentions: FeishuMention[] | undefined,
  botOpenId: string | undefined,
): boolean {
  if (!mentions?.length || !botOpenId) return false;
  return mentions.some((m) => m.id.open_id === botOpenId);
}

/**
 * Normalize mention placeholders: replace non-bot mentions with
 * `<at user_id="...">name</at>` tags for agent consumption.
 */
export function normalizeMentions(
  text: string,
  mentions: FeishuMention[] | undefined,
  botOpenId: string | undefined,
): string {
  if (!mentions?.length) return text;
  for (const m of mentions) {
    if (m.id.open_id === botOpenId) continue;
    const rawOpenId = m.id.open_id || m.id.user_id || "";
    const openId = rawOpenId.replace(/"/g, "&quot;");
    const safeName = m.name.replace(/[<>&"]/g, (ch) => {
      switch (ch) {
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "&": return "&amp;";
        case "\"": return "&quot;";
        default: return ch;
      }
    });
    const replacement = `<at user_id="${openId}">${safeName}</at>`;
    text = text.replace(
      new RegExp(m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      replacement,
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// Group session scope resolution
// ---------------------------------------------------------------------------

export type ResolvedFeishuGroupSession = {
  peerId: string;
  replyInThread: boolean;
  threadReply: boolean;
};

export function resolveFeishuGroupSession(params: {
  chatId: string;
  senderOpenId: string;
  messageId: string;
  rootId?: string;
  threadId?: string;
  groupSessionScope?: GroupSessionScope;
  replyInThread?: "enabled" | "disabled";
  topicSessionMode?: "enabled" | "disabled";
}): ResolvedFeishuGroupSession {
  const { chatId, senderOpenId, messageId, rootId, threadId } = params;
  const normalizedThreadId = threadId?.trim();
  const normalizedRootId = rootId?.trim();
  const threadReply = Boolean(normalizedThreadId || normalizedRootId);

  const replyInThread =
    (params.replyInThread ?? "disabled") === "enabled" || threadReply;

  // Resolve groupSessionScope, with legacy topicSessionMode fallback
  const legacyTopicSessionMode = params.topicSessionMode ?? "disabled";
  const groupSessionScope: GroupSessionScope =
    params.groupSessionScope ??
    (legacyTopicSessionMode === "enabled" ? "group_topic" : "group");

  const topicScope =
    groupSessionScope === "group_topic" || groupSessionScope === "group_topic_sender"
      ? (normalizedRootId ?? normalizedThreadId ?? (replyInThread ? messageId : null))
      : null;

  let peerId = chatId;
  switch (groupSessionScope) {
    case "group_sender":
      peerId = `${chatId}:sender:${senderOpenId}`;
      break;
    case "group_topic":
      peerId = topicScope ? `${chatId}:topic:${topicScope}` : chatId;
      break;
    case "group_topic_sender":
      peerId = topicScope
        ? `${chatId}:topic:${topicScope}:sender:${senderOpenId}`
        : `${chatId}:sender:${senderOpenId}`;
      break;
    case "group":
    default:
      peerId = chatId;
      break;
  }

  return { peerId, replyInThread, threadReply };
}
