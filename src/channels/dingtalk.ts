/**
 * DingTalk channel plugin for Klaus.
 * Aligned with openclaw-china/extensions/dingtalk/src/
 *
 * Uses DingTalk Stream SDK for real-time message reception.
 * Supports direct messages and group chats (with @mention detection).
 */

import { TOPIC_ROBOT, type DWClient, type DWClientDownStream } from "dingtalk-stream";
import { singleAccountConfig, type ChannelPlugin, type ChannelGatewayContext } from "./types.js";
import type { InboundMessage, MessageType } from "../message.js";
import type {
  DingtalkConfig,
  DingtalkRawMessage,
  DingtalkMediaContent,
} from "./dingtalk-types.js";
import { decryptCred } from "./channel-creds.js";
import { MessageDedup } from "./dedup.js";
import { createDingtalkClient } from "./dingtalk-client.js";
import { sendTextMessage, sendMessage } from "./dingtalk-send.js";
import { createAICard, finishAICard } from "./dingtalk-card.js";

// ---------------------------------------------------------------------------
// Message parsing (aligned with openclaw-china bot-handler.ts)
// ---------------------------------------------------------------------------

function parseMessageContent(raw: DingtalkRawMessage): { text: string; contentType: string } {
  // Text message
  if (raw.msgtype === "text" && raw.text?.content) {
    return { text: raw.text.content.trim(), contentType: "text" };
  }

  // Media messages — extract content
  if (raw.content) {
    const content: DingtalkMediaContent =
      typeof raw.content === "string"
        ? (() => { try { return JSON.parse(raw.content); } catch { return {}; } })()
        : raw.content;

    // Audio with recognition
    if (raw.msgtype === "audio" && content.recognition) {
      return { text: content.recognition.trim(), contentType: "audio" };
    }

    // Rich text
    if (raw.msgtype === "richText" && content.richText) {
      const elements = typeof content.richText === "string"
        ? (() => { try { return JSON.parse(content.richText); } catch { return []; } })()
        : content.richText;

      if (Array.isArray(elements)) {
        const texts = elements
          .filter((el) => el.type === "text" && el.text)
          .map((el) => el.text!);
        if (texts.length > 0) {
          return { text: texts.join(""), contentType: "richText" };
        }
      }
    }

    // File
    if (raw.msgtype === "file" && content.fileName) {
      return { text: `[文件: ${content.fileName}]`, contentType: "file" };
    }

    // Picture / video
    if (raw.msgtype === "picture" || raw.msgtype === "image") {
      return { text: "[图片]", contentType: "image" };
    }
    if (raw.msgtype === "video") {
      return { text: "[视频]", contentType: "video" };
    }
  }

  return { text: `[${raw.msgtype || "unknown"}]`, contentType: raw.msgtype || "unknown" };
}

function toMessageType(contentType: string): MessageType {
  switch (contentType) {
    case "text":
    case "richText":
    case "audio":
      return "text";
    case "image":
    case "picture":
      return "image";
    case "file":
      return "file";
    case "video":
      return "video";
    default:
      return "text";
  }
}

// ---------------------------------------------------------------------------
// Convert raw message → InboundMessage
// ---------------------------------------------------------------------------

function toInboundMessage(raw: DingtalkRawMessage): InboundMessage {
  const { text, contentType } = parseMessageContent(raw);
  const chatType = raw.conversationType === "1" ? "private" : "group";

  // Strip bot @mention from text
  let cleanText = text;
  if (chatType === "group" && raw.atUsers?.length) {
    cleanText = text.replace(/@\S+\s*/g, "").trim();
  }

  const sessionKey = chatType === "private"
    ? `dingtalk:${raw.senderId}`
    : `dingtalk:${raw.conversationId}`;

  return {
    sessionKey,
    text: cleanText,
    messageType: toMessageType(contentType),
    chatType: chatType === "private" ? "private" : "group",
    senderId: raw.senderId,
    senderName: raw.senderNick,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

// Module-level config cached for deliver() and outbound
let cachedConfig: DingtalkConfig | undefined;

export const dingtalkPlugin: ChannelPlugin = {
  meta: {
    id: "dingtalk",
    label: "DingTalk",
    description: "钉钉机器人，通过 Stream 模式接收消息",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
    mention: true,
  },

  config: singleAccountConfig<DingtalkConfig>("dingtalk", "client_id", (store) => {
    const clientId = store.get("channel.dingtalk.client_id");
    const clientSecret = decryptCred(store.get("channel.dingtalk.client_secret") ?? "");
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }),

  groups: {
    resolveRequireMention: () => true, // DingTalk always requires @mention in groups
  },

  mentions: {
    stripMentions: (text) => text.replace(/@\S+\s*/g, "").trim(),
  },

  outbound: {
    deliveryMode: "gateway",
    async sendText(ctx, text) {
      if (!cachedConfig) return { ok: false, error: "Not configured" };
      try {
        const chatType = ctx.chatType === "direct" ? "direct" : "group";
        await sendTextMessage({ config: cachedConfig, to: ctx.targetId, text, chatType });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext) => {
      const config = ctx.account as DingtalkConfig;
      cachedConfig = config;
      const dedup = new MessageDedup();

      console.log("[DingTalk] Starting (mode=stream)");

      // Create Stream client
      const client = createDingtalkClient(config);

      // Register message handler
      client.registerCallbackListener(TOPIC_ROBOT, (payload: DWClientDownStream) => {
        const streamMessageId = payload?.headers?.messageId;

        // ACK immediately
        if (streamMessageId) {
          try {
            client.socketCallBackResponse(streamMessageId, { success: true });
          } catch (err) {
            console.error(`[DingTalk] ACK failed for ${streamMessageId}:`, err);
          }
        }

        // Dedup
        if (streamMessageId && dedup.isDuplicate(`dingtalk:${streamMessageId}`)) return;

        // Parse and handle
        let raw: DingtalkRawMessage;
        try {
          raw = JSON.parse(payload.data) as DingtalkRawMessage;
          if (streamMessageId) raw.streamMessageId = streamMessageId;
        } catch (err) {
          console.error("[DingTalk] Failed to parse message:", err);
          return;
        }

        const senderName = raw.senderNick ?? raw.senderId;
        const preview = (raw.text?.content ?? "").slice(0, 50);
        console.log(`[DingTalk] Inbound: from=${senderName} text="${preview}"`);

        ctx.setStatus({ lastInboundAt: Date.now() });

        // In group chats, only respond when bot is @mentioned
        if (raw.conversationType === "2") {
          const botMentioned = raw.atUsers?.some(
            (u) => u.dingtalkId === raw.robotCode,
          );
          if (!botMentioned) return;
        }

        // Process message
        void (async () => {
          try {
            const msg = toInboundMessage(raw);
            if (!msg.text.trim()) return;

            // Write user message to transcript + push to web
            await ctx.transcript(msg.sessionKey, "user", msg.text.trim());
            ctx.notify(msg.sessionKey, "user", msg.text.trim());

            // Create AI Card as typing indicator
            const card = await createAICard({
              config,
              conversationType: raw.conversationType,
              conversationId: raw.conversationId,
              senderId: raw.senderId,
            });

            const reply = await ctx.handler(msg);
            if (reply) {
              // Write assistant reply to transcript + push to web
              await ctx.transcript(msg.sessionKey, "assistant", reply);
              ctx.notify(msg.sessionKey, "assistant", reply);
              ctx.setStatus({ lastOutboundAt: Date.now() });

              // Send reply: update AI Card if available, otherwise send text
              if (card) {
                await finishAICard({ card, content: reply });
              } else {
                const chatType = raw.conversationType === "1" ? "direct" : "group";
                const to = chatType === "direct" ? raw.senderId : raw.conversationId;
                await sendTextMessage({ config, to, text: reply, chatType });
              }
            }
          } catch (err) {
            ctx.setStatus({ lastError: String(err) });
            console.error("[DingTalk] Error handling message:", err);
          }
        })();
      });

      // Connect
      await client.connect();
      ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });
      console.log("[DingTalk] Stream client connected");

      // Block until abort signal
      return new Promise<void>((resolve) => {
        const shutdown = () => {
          console.log("[DingTalk] Shutting down...");
          ctx.setStatus({ connected: false });
          dedup.clear();
          try { client.disconnect(); } catch { /* ignore */ }
          resolve();
        };
        if (ctx.signal.aborted) { shutdown(); return; }
        ctx.signal.addEventListener("abort", shutdown, { once: true });
      });
    },
  },

  deliver: async (to: string, text: string) => {
    if (!cachedConfig) {
      console.warn("[DingTalk] deliver() skipped: not configured");
      return;
    }
    await sendMessage({ config: cachedConfig, to, text });
  },
};
