/**
 * Feishu message sending: text, card, reply fallback, thread support.
 * Aligned with OpenClaw's extensions/feishu/src/send.ts
 */

import type * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, FeishuSendResult } from "./feishu-types.js";
import { createFeishuClient } from "./feishu-client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Error codes indicating the reply target was withdrawn/deleted. */
const WITHDRAWN_REPLY_ERROR_CODES = new Set([230011, 231003]);

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

function shouldFallbackFromReplyTarget(response: { code?: number; msg?: string }): boolean {
  if (response.code !== undefined && WITHDRAWN_REPLY_ERROR_CODES.has(response.code)) {
    return true;
  }
  const msg = response.msg?.toLowerCase() ?? "";
  return msg.includes("withdrawn") || msg.includes("not found");
}

function isWithdrawnReplyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const code = (err as { code?: number }).code;
  if (typeof code === "number" && WITHDRAWN_REPLY_ERROR_CODES.has(code)) return true;

  const response = (err as { response?: { data?: { code?: number; msg?: string } } }).response;
  if (
    typeof response?.data?.code === "number" &&
    WITHDRAWN_REPLY_ERROR_CODES.has(response.data.code)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

function assertFeishuApiSuccess(
  response: { code?: number; msg?: string },
  errorPrefix: string,
): void {
  if (response.code !== 0) {
    throw new Error(`${errorPrefix}: ${response.msg || `code ${response.code}`}`);
  }
}

function toSendResult(
  response: { data?: { message_id?: string } },
  chatId: string,
): FeishuSendResult {
  return {
    messageId: (response.data as { message_id?: string } | undefined)?.message_id ?? "unknown",
    chatId,
  };
}

// ---------------------------------------------------------------------------
// Core send primitives
// ---------------------------------------------------------------------------

function getClient(config: FeishuConfig): Lark.Client {
  return createFeishuClient(config);
}

/** Send a direct message (no reply target). */
async function sendDirect(
  client: Lark.Client,
  params: {
    receiveId: string;
    receiveIdType: "chat_id" | "open_id" | "user_id";
    content: string;
    msgType: string;
  },
  errorPrefix: string,
): Promise<FeishuSendResult> {
  const response = await client.im.message.create({
    params: { receive_id_type: params.receiveIdType },
    data: {
      receive_id: params.receiveId,
      content: params.content,
      msg_type: params.msgType,
    },
  });
  assertFeishuApiSuccess(response, errorPrefix);
  return toSendResult(response, params.receiveId);
}

/**
 * Reply to a message, with fallback to direct send if the target was withdrawn.
 * For thread replies, does NOT fall back (would create orphan top-level message).
 */
async function sendReplyOrFallback(
  client: Lark.Client,
  params: {
    replyToMessageId?: string;
    replyInThread?: boolean;
    content: string;
    msgType: string;
    receiveId: string;
    receiveIdType: "chat_id" | "open_id" | "user_id";
  },
  errorPrefix: string,
): Promise<FeishuSendResult> {
  if (!params.replyToMessageId) {
    return sendDirect(client, {
      receiveId: params.receiveId,
      receiveIdType: params.receiveIdType,
      content: params.content,
      msgType: params.msgType,
    }, errorPrefix);
  }

  const threadReplyFallbackError = params.replyInThread
    ? new Error(
        "Feishu thread reply failed: reply target is unavailable and cannot safely fall back.",
      )
    : null;

  let response: { code?: number; msg?: string; data?: { message_id?: string } };
  try {
    response = await client.im.message.reply({
      path: { message_id: params.replyToMessageId },
      data: {
        content: params.content,
        msg_type: params.msgType,
        ...(params.replyInThread ? { reply_in_thread: true } : {}),
      },
    });
  } catch (err) {
    if (!isWithdrawnReplyError(err)) throw err;
    if (threadReplyFallbackError) throw threadReplyFallbackError;
    return sendDirect(client, {
      receiveId: params.receiveId,
      receiveIdType: params.receiveIdType,
      content: params.content,
      msgType: params.msgType,
    }, errorPrefix);
  }

  if (shouldFallbackFromReplyTarget(response)) {
    if (threadReplyFallbackError) throw threadReplyFallbackError;
    return sendDirect(client, {
      receiveId: params.receiveId,
      receiveIdType: params.receiveIdType,
      content: params.content,
      msgType: params.msgType,
    }, errorPrefix);
  }

  assertFeishuApiSuccess(response, errorPrefix);
  return toSendResult(response, params.receiveId);
}

// ---------------------------------------------------------------------------
// Receive ID type resolution
// ---------------------------------------------------------------------------

function resolveReceiveIdType(target: string): "chat_id" | "open_id" | "user_id" {
  const trimmed = target.trim();
  if (trimmed.startsWith("oc_")) return "chat_id";
  if (trimmed.startsWith("ou_")) return "open_id";
  return "open_id"; // Default to open_id
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text reply to a chat. Handles reply fallback for withdrawn messages.
 */
export async function sendTextMessage(params: {
  config: FeishuConfig;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  replyInThread?: boolean;
}): Promise<FeishuSendResult> {
  const client = getClient(params.config);
  const content = JSON.stringify({ text: params.text });

  return sendReplyOrFallback(client, {
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    content,
    msgType: "text",
    receiveId: params.chatId,
    receiveIdType: "chat_id",
  }, "Feishu text send failed");
}

/**
 * Send a markdown card message.
 */
export async function sendCardMessage(params: {
  config: FeishuConfig;
  chatId: string;
  markdown: string;
  title?: string;
  color?: string;
  replyToMessageId?: string;
  replyInThread?: boolean;
}): Promise<FeishuSendResult> {
  const client = getClient(params.config);

  const elements: unknown[] = [];
  if (params.markdown) {
    elements.push({
      tag: "markdown",
      content: params.markdown,
    });
  }

  const card: Record<string, unknown> = {
    config: { wide_screen_mode: true },
    elements,
  };
  if (params.title) {
    card.header = {
      title: { tag: "plain_text", content: params.title },
      ...(params.color ? { template: params.color } : {}),
    };
  }

  const content = JSON.stringify(card);

  return sendReplyOrFallback(client, {
    replyToMessageId: params.replyToMessageId,
    replyInThread: params.replyInThread,
    content,
    msgType: "interactive",
    receiveId: params.chatId,
    receiveIdType: "chat_id",
  }, "Feishu card send failed");
}

/**
 * Send a proactive message to any target (open_id or chat_id).
 */
export async function sendMessage(params: {
  config: FeishuConfig;
  to: string;
  text: string;
}): Promise<FeishuSendResult> {
  const client = getClient(params.config);
  const content = JSON.stringify({ text: params.text });
  const receiveIdType = resolveReceiveIdType(params.to);

  return sendDirect(client, {
    receiveId: params.to,
    receiveIdType,
    content,
    msgType: "text",
  }, "Feishu send failed");
}

