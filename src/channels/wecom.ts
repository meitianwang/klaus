/**
 * WeCom (企业微信) smart bot channel plugin for Klaus.
 * Aligned with openclaw-china/extensions/wecom.
 *
 * Uses @wecom/aibot-node-sdk WebSocket mode for real-time messaging.
 * Supports direct messages and group chats.
 */

import crypto from "node:crypto";
import { WSClient, type WsFrame } from "@wecom/aibot-node-sdk";
import { singleAccountConfig, type ChannelPlugin, type ChannelGatewayContext } from "./types.js";
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

export const wecomPlugin: ChannelPlugin = {
  meta: {
    id: "wecom",
    label: "WeCom",
    description: "企业微信智能机器人（WebSocket 长连接）",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
  },

  config: singleAccountConfig<WecomConfig>("wecom", "bot_id", (store) => {
    const botId = store.get("channel.wecom.bot_id");
    const secret = decryptCred(store.get("channel.wecom.secret") ?? "");
    return botId && secret ? { botId, secret } : null;
  }),

  status: {
    async probeAccount(params) {
      const config = params.config as WecomConfig;
      return probeWecomCredentials(config, params.timeoutMs);
    },
  },

  outbound: {
    deliveryMode: "direct",
    sendText: async (ctx, text) => {
      if (!activeClient) return { ok: false, error: "No active connection" };
      const chatId = ctx.targetId;
      try {
        await activeClient.sendMessage(chatId, {
          msgtype: "markdown",
          markdown: { content: text },
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 20, idleMs: 500 },
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext) => {
      const config = ctx.account as WecomConfig;
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
        ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });
        console.log("[WeCom] WebSocket authenticated");
      });

      client.on("reconnecting", (attempt) => {
        ctx.setStatus({ connected: false, reconnectAttempts: attempt });
        console.log(`[WeCom] Reconnecting (attempt=${attempt})`);
      });

      client.on("error", (error) => {
        ctx.setStatus({ lastError: error.message });
        console.error("[WeCom] SDK error:", error.message);
      });

      client.on("disconnected", (reason) => {
        ctx.setStatus({ connected: false, lastDisconnect: { at: Date.now(), reason } });
        console.log(`[WeCom] Disconnected: ${reason}`);
      });

      client.on("message", (frame: WsFrame) => {
        const msg = frame.body as WecomInboundMessage | undefined;
        if (!msg) return;

        const reqId = frame.headers?.req_id;
        const msgId = msg.msgid;

        if (msgId && dedup.isDuplicate(`wecom:${msgId}`)) return;
        if (msg.msgtype === "event") return;
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

        ctx.setStatus({ lastInboundAt: Date.now() });

        const inbound: InboundMessage = {
          sessionKey,
          text,
          messageType: contentType,
          chatType,
          senderId,
          timestamp: Date.now(),
        };

        void (async () => {
          try {
            await ctx.transcript(sessionKey, "user", text);
            ctx.notify(sessionKey, "user", text);

            const streamId = crypto.randomBytes(16).toString("hex");
            const frameHeaders = { headers: { req_id: reqId ?? "" } };

            try {
              await client.replyStream(frameHeaders, streamId, "...", false);
            } catch { /* placeholder failure is non-fatal */ }

            const reply = await ctx.handler(inbound);
            if (reply) {
              await ctx.transcript(sessionKey, "assistant", reply);
              ctx.notify(sessionKey, "assistant", reply);
              ctx.setStatus({ lastOutboundAt: Date.now() });

              try {
                await client.replyStream(frameHeaders, streamId, reply, true);
              } catch (err) {
                console.error("[WeCom] Failed to send reply:", err);
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

      client.on("event", (_frame: WsFrame) => {
        ctx.setStatus({ lastEventAt: Date.now() });
      });

      client.connect();
      console.log("[WeCom] WebSocket client connecting...");

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

    stopAccount: async () => {
      if (activeClient) {
        try { activeClient.disconnect(); } catch { /* ignore */ }
        activeClient = undefined;
      }
    },
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
};
