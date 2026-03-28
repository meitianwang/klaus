/**
 * WeCom (企业微信) smart bot channel plugin for Klaus.
 * Aligned with openclaw-china/extensions/wecom.
 *
 * Uses @wecom/aibot-node-sdk WebSocket mode for real-time messaging.
 * Supports direct messages and group chats.
 */

import crypto from "node:crypto";
import { WSClient, type WsFrame } from "@wecom/aibot-node-sdk";
import type { ChannelPlugin, ChannelContext } from "./types.js";
import type { InboundMessage, MessageType } from "../message.js";
import type { WecomConfig, WecomInboundMessage } from "./wecom-types.js";
import { decryptCred } from "./channel-creds.js";
import { MessageDedup } from "./dedup.js";

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

function extractText(msg: WecomInboundMessage): { text: string; contentType: MessageType } {
  const msgtype = msg.msgtype ?? "";

  if (msgtype === "text" && msg.text?.content) {
    return { text: msg.text.content.trim(), contentType: "text" };
  }
  if (msgtype === "voice" && msg.voice?.content) {
    return { text: msg.voice.content.trim(), contentType: "text" };
  }
  if (msgtype === "image") {
    return { text: "[图片]", contentType: "image" };
  }
  if (msgtype === "file") {
    const name = msg.file?.filename ?? "file";
    return { text: `[文件: ${name}]`, contentType: "file" };
  }
  if (msgtype === "event") {
    return { text: "", contentType: "text" };
  }

  return { text: `[${msgtype || "unknown"}]`, contentType: "text" };
}

function resolveTarget(msg: WecomInboundMessage): { chatType: "private" | "group"; peerId: string } {
  const chattype = String(msg.chattype ?? "").toLowerCase();
  if (chattype === "group") {
    const chatId = String(msg.chatid ?? "").trim() || "unknown";
    return { chatType: "group", peerId: chatId };
  }
  const userId = String(msg.from?.userid ?? "").trim() || "unknown";
  return { chatType: "private", peerId: userId };
}

// ---------------------------------------------------------------------------
// Credential probe (quick connect → authenticate → disconnect)
// ---------------------------------------------------------------------------

export async function probeWecomCredentials(
  config: WecomConfig,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { client.disconnect(); } catch { /* ignore */ }
      resolve({ ok: false, error: "Connection timed out. Check Bot ID and Secret." });
    }, timeoutMs);

    const client = new WSClient({
      botId: config.botId,
      secret: config.secret,
      maxReconnectAttempts: 0,
      maxAuthFailureAttempts: 1,
      heartbeatInterval: 30_000,
      requestTimeout: timeoutMs - 1_000,
    });

    client.on("authenticated", () => {
      clearTimeout(timer);
      try { client.disconnect(); } catch { /* ignore */ }
      resolve({ ok: true });
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      try { client.disconnect(); } catch { /* ignore */ }
      resolve({ ok: false, error: err.message });
    });

    try {
      client.connect();
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err) });
    }
  });
}

// Module-level client reference for deliver() support
let activeClient: WSClient | undefined;
// Module-level config cached from last resolveConfig for probe()
let cachedConfig: WecomConfig | undefined;

export const wecomPlugin: ChannelPlugin = {
  meta: {
    id: "wecom",
    label: "WeCom",
    description: "企业微信智能机器人（WebSocket 长连接）",
  },

  capabilities: {
    dm: true,
    group: true,
  },

  resolveConfig: (store) => {
    const botId = store.get("channel.wecom.bot_id");
    const secret = decryptCred(store.get("channel.wecom.secret") ?? "");
    const enabled = store.getBool("channel.wecom.enabled", false);
    if (!enabled || !botId || !secret) return null;

    cachedConfig = { botId, secret };
    return {
      enabled: true,
      ownerId: store.get("channel.wecom.owner_id") ?? undefined,
      botId,
      secret,
    };
  },

  start: async (ctx: ChannelContext) => {
    if (!cachedConfig) throw new Error("WeCom config not resolved");
    const config = cachedConfig;

    const dedup = new MessageDedup();

    console.log("[WeCom] Starting (mode=ws)");

    const client = new WSClient({
      botId: config.botId,
      secret: config.secret,
      maxReconnectAttempts: -1,
      heartbeatInterval: 30_000,
      reconnectInterval: 1_000,
    });
    activeClient = client;

    client.on("authenticated", () => {
      console.log("[WeCom] WebSocket authenticated");
    });

    client.on("reconnecting", (attempt) => {
      console.log(`[WeCom] Reconnecting (attempt=${attempt})`);
    });

    client.on("error", (error) => {
      console.error("[WeCom] SDK error:", error.message);
    });

    client.on("disconnected", (reason) => {
      console.log(`[WeCom] Disconnected: ${reason}`);
    });

    // Handle inbound messages
    client.on("message", (frame: WsFrame) => {
      const msg = frame.body as WecomInboundMessage | undefined;
      if (!msg) return;

      const reqId = frame.headers?.req_id;
      const msgId = msg.msgid;

      // Dedup
      if (msgId && dedup.isDuplicate(`wecom:${msgId}`)) return;

      // Skip events (enter_chat etc.)
      if (msg.msgtype === "event") return;
      // Skip stream refresh signals
      if (msg.msgtype === "stream") return;

      const { text, contentType } = extractText(msg);
      if (!text.trim()) return;

      const { chatType, peerId } = resolveTarget(msg);
      const sessionKey = chatType === "private"
        ? `wecom:${msg.from?.userid ?? peerId}`
        : `wecom:${msg.chatid ?? peerId}`;

      const senderId = String(msg.from?.userid ?? "").trim();
      const preview = text.slice(0, 50);
      console.log(`[WeCom] Inbound: from=${senderId} chatType=${chatType} text="${preview}"`);

      const inbound: InboundMessage = {
        sessionKey,
        text,
        messageType: contentType,
        chatType,
        senderId,
        timestamp: Date.now(),
      };

      // Process asynchronously
      void (async () => {
        try {
          // Write user message to transcript + push to web
          await ctx.transcript(sessionKey, "user", text);
          ctx.notify(sessionKey, "user", text);

          // Generate stream ID for streaming reply
          const streamId = crypto.randomBytes(16).toString("hex");
          const frameHeaders = { headers: { req_id: reqId ?? "" } };

          // Send "thinking" placeholder
          try {
            await client.replyStream(frameHeaders, streamId, "...", false);
          } catch {
            // Placeholder failure is non-fatal
          }

          const reply = await ctx.handler(inbound);
          if (reply) {
            // Write assistant reply to transcript + push to web
            await ctx.transcript(sessionKey, "assistant", reply);
            ctx.notify(sessionKey, "assistant", reply);

            // Send final reply via streaming finish
            try {
              await client.replyStream(frameHeaders, streamId, reply, true);
            } catch (err) {
              console.error("[WeCom] Failed to send reply:", err);
              // Fallback: try sendMessage for proactive send
              try {
                const chatId = chatType === "private" ? senderId : (msg.chatid ?? peerId);
                await client.sendMessage(chatId, {
                  msgtype: "markdown",
                  markdown: { content: reply },
                });
              } catch (fallbackErr) {
                console.error("[WeCom] Fallback send also failed:", fallbackErr);
              }
            }
          }
        } catch (err) {
          console.error("[WeCom] Error handling message:", err);
        }
      })();
    });

    // Handle events (enter_chat welcome)
    client.on("event", (frame: WsFrame) => {
      const msg = frame.body as WecomInboundMessage | undefined;
      if (!msg) return;
      // Could add welcome message handling here if needed
    });

    // Connect
    client.connect();
    console.log("[WeCom] WebSocket client connecting...");

    // Block until abort signal
    return new Promise<void>((resolve) => {
      const shutdown = () => {
        console.log("[WeCom] Shutting down...");
        activeClient = undefined;
        dedup.clear();
        try { client.disconnect(); } catch { /* ignore */ }
        resolve();
      };
      if (ctx.signal.aborted) { shutdown(); return; }
      ctx.signal.addEventListener("abort", shutdown, { once: true });
    });
  },

  deliver: async (to: string, text: string) => {
    if (!activeClient) {
      console.warn(`[WeCom] deliver() skipped: no active connection (to=${to})`);
      return;
    }
    await activeClient.sendMessage(to, {
      msgtype: "markdown",
      markdown: { content: text },
    });
  },

  probe: async () => {
    if (!cachedConfig) return { ok: false, error: "Not configured" };
    return probeWecomCredentials(cachedConfig);
  },
};
