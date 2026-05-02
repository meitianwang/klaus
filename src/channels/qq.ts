/**
 * QQ Bot channel plugin for Klaus.
 * Uses QQ Bot Open API v2 with WebSocket gateway for message reception.
 *
 * Supports C2C (private) and group @bot messages.
 * Authentication via AppID + AppSecret from QQ Open Platform.
 */

import WebSocket from "ws";
import { singleAccountConfig, type ChannelPlugin, type ChannelGatewayContext } from "./types.js";
import type { InboundMessage } from "../message.js";
import type { QQBotConfig, WSPayload, C2CMessageEvent, GroupMessageEvent } from "./qq-types.js";
import { decryptCred } from "./channel-creds.js";
import { MessageDedup } from "./dedup.js";
import {
  getAccessToken,
  getGatewayUrl,
  sendC2CMessage,
  sendGroupMessage,
  clearTokenCache,
} from "./qq-api.js";

// ---------------------------------------------------------------------------
// @mention text cleanup
// ---------------------------------------------------------------------------

function stripMentionText(text: string): string {
  return text.replace(/<@!?\w+>/g, "").trim();
}

// ---------------------------------------------------------------------------
// WebSocket intents & reconnect config
// ---------------------------------------------------------------------------

// GROUP_AND_C2C (1<<25) | INTERACTION (1<<26) | PUBLIC_GUILD_MESSAGES (1<<30) | DIRECT_MESSAGE (1<<12)
const FULL_INTENTS = (1 << 25) | (1 << 26) | (1 << 30) | (1 << 12);

const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
const MAX_RECONNECT_ATTEMPTS = 100;

// ---------------------------------------------------------------------------
// Module-level config cached for deliver() and outbound
// ---------------------------------------------------------------------------

let cachedConfig: QQBotConfig | undefined;

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

async function processMessage(
  ctx: ChannelGatewayContext,
  config: QQBotConfig,
  params: {
    type: "c2c" | "group";
    senderId: string;
    senderName?: string;
    content: string;
    messageId: string;
    timestamp: string;
    groupOpenid?: string;
  },
): Promise<void> {
  const { type, senderId, content, messageId, groupOpenid } = params;

  const cleanContent = type === "group" ? stripMentionText(content) : content;
  if (!cleanContent.trim()) return;

  const sessionKey = type === "group" && groupOpenid
    ? `qq:group:${groupOpenid}`
    : `qq:${senderId}`;

  const inbound: InboundMessage = {
    sessionKey,
    text: cleanContent,
    messageType: "text",
    chatType: type === "group" ? "group" : "private",
    senderId,
    senderName: params.senderName,
    timestamp: new Date(params.timestamp).getTime() || Date.now(),
  };

  try {
    ctx.transcript(inbound.sessionKey, "user", cleanContent).catch(() => {});
    ctx.notify(inbound.sessionKey, "user", cleanContent);

    ctx.setStatus({ lastInboundAt: Date.now() });

    const reply = await ctx.handler(inbound);
    if (!reply) return;

    ctx.transcript(inbound.sessionKey, "assistant", reply).catch(() => {});
    ctx.notify(inbound.sessionKey, "assistant", reply);

    ctx.setStatus({ lastOutboundAt: Date.now() });

    if (ctx.sendOutbound) {
      await ctx.sendOutbound({
        sessionKey: inbound.sessionKey,
        chatType: type === "group" ? "group" : "direct",
        targetId: type === "group" && groupOpenid ? groupOpenid : senderId,
        text: reply,
        replyToMessageId: messageId,
      });
    } else {
      console.error("[QQ] No outbound adapter — reply dropped");
    }
  } catch (err) {
    console.error("[QQ] Error handling message:", err);
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const qqPlugin: ChannelPlugin<QQBotConfig> = {
  meta: {
    id: "qq",
    label: "QQ Bot",
    description: "QQ 机器人，通过 QQ 开放平台 API 连接",
    order: 4,
    icon: "qq",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
  },

  configSchema: {
    fields: [
      { key: "app_id", type: "string", label: "App ID", required: true },
      { key: "client_secret", type: "secret", label: "Client Secret", required: true },
    ],
    deleteKeys: ["owner_id"],
  },

  config: singleAccountConfig<QQBotConfig>("qq", "app_id", async (store) => {
    const appId = await store.get("channel.qq.app_id");
    const clientSecret = decryptCred((await store.get("channel.qq.client_secret")) ?? "");
    return appId && clientSecret ? { appId, clientSecret } : null;
  }),

  mentions: {
    stripMentions: (text) => text.replace(/<@!?\w+>/g, "").trim(),
  },

  outbound: {
    deliveryMode: "direct",
    async sendText(ctx, text) {
      if (!cachedConfig) return { ok: false, error: "Not configured" };
      try {
        const token = await getAccessToken(cachedConfig.appId, cachedConfig.clientSecret);
        if (ctx.chatType === "group" && ctx.targetId) {
          await sendGroupMessage(token, ctx.targetId, text, ctx.replyToMessageId);
        } else {
          await sendC2CMessage(token, ctx.targetId, text, ctx.replyToMessageId);
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
      const dedup = new MessageDedup();

      console.log("[QQ] Starting (mode=websocket-gateway)");

      let running = true;
      let reconnectAttempts = 0;
      let currentWs: WebSocket | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
      let sessionId: string | null = null;
      let lastSeq: number | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
          currentWs.close();
        }
        currentWs = null;
      };

      const connect = async (): Promise<void> => {
        cleanup();

        try {
          const accessToken = await getAccessToken(config.appId, config.clientSecret);
          console.log("[QQ] Access token obtained");
          const gatewayUrl = await getGatewayUrl(accessToken);
          console.log(`[QQ] Connecting to ${gatewayUrl}`);

          const ws = new WebSocket(gatewayUrl);
          currentWs = ws;

          ws.on("message", (data) => {
            try {
              const payload = JSON.parse(data.toString()) as WSPayload;
              const { op, d, s, t } = payload;

              if (s) lastSeq = s;

              switch (op) {
                case 10: {
                  // Hello — send Identify or Resume
                  console.log("[QQ] Hello received");
                  if (sessionId && lastSeq !== null) {
                    console.log(`[QQ] Resuming session ${sessionId}`);
                    ws.send(JSON.stringify({
                      op: 6,
                      d: { token: `QQBot ${accessToken}`, session_id: sessionId, seq: lastSeq },
                    }));
                  } else {
                    console.log("[QQ] Sending identify");
                    ws.send(JSON.stringify({
                      op: 2,
                      d: { token: `QQBot ${accessToken}`, intents: FULL_INTENTS, shard: [0, 1] },
                    }));
                  }
                  const interval = (d as { heartbeat_interval: number }).heartbeat_interval;
                  if (heartbeatInterval) clearInterval(heartbeatInterval);
                  heartbeatInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({ op: 1, d: lastSeq }));
                    }
                  }, interval);
                  break;
                }

                case 0: // Dispatch
                  if (t === "READY") {
                    sessionId = (d as { session_id: string }).session_id;
                    reconnectAttempts = 0;
                    ctx.setStatus({ connected: true, lastConnectedAt: Date.now(), mode: "websocket", tokenStatus: "valid" });
                    console.log(`[QQ] Ready, session: ${sessionId}`);
                  } else if (t === "RESUMED") {
                    reconnectAttempts = 0;
                    ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });
                    console.log("[QQ] Session resumed");
                  } else if (t === "C2C_MESSAGE_CREATE") {
                    const event = d as C2CMessageEvent;
                    if (!dedup.isDuplicate(`qq:c2c:${event.id}`)) {
                      void processMessage(ctx, config, {
                        type: "c2c",
                        senderId: event.author.user_openid,
                        content: event.content,
                        messageId: event.id,
                        timestamp: event.timestamp,
                      });
                    }
                  } else if (t === "GROUP_AT_MESSAGE_CREATE") {
                    const event = d as GroupMessageEvent;
                    if (!dedup.isDuplicate(`qq:group:${event.id}`)) {
                      void processMessage(ctx, config, {
                        type: "group",
                        senderId: event.author.member_openid,
                        senderName: event.author.username,
                        content: event.content,
                        messageId: event.id,
                        timestamp: event.timestamp,
                        groupOpenid: event.group_openid,
                      });
                    }
                  } else if (t === "GROUP_ADD_ROBOT") {
                    const ev = d as { group_openid: string; op_member_openid: string };
                    console.log(`[QQ] Bot added to group: ${ev.group_openid} by ${ev.op_member_openid}`);
                  } else if (t === "GROUP_DEL_ROBOT") {
                    const ev = d as { group_openid: string; op_member_openid: string };
                    console.log(`[QQ] Bot removed from group: ${ev.group_openid} by ${ev.op_member_openid}`);
                  }
                  break;

                case 11: // Heartbeat ACK
                  break;

                case 9: // Invalid Session
                  console.warn("[QQ] Invalid session, clearing session state");
                  ctx.setStatus({ lastError: "Invalid session" });
                  sessionId = null;
                  lastSeq = null;
                  clearTokenCache(config.appId);
                  ws.close();
                  break;

                case 7: // Server requested reconnect
                  console.log("[QQ] Server requested reconnect");
                  ws.close();
                  break;
              }
            } catch (err) {
              console.error("[QQ] Error processing WS message:", err);
            }
          });

          ws.on("open", () => {
            console.log("[QQ] WebSocket connected");
          });

          ws.on("close", (code, reason) => {
            console.log(`[QQ] WebSocket closed: code=${code} reason=${reason.toString()}`);
            ctx.setStatus({ connected: false, lastDisconnect: { at: Date.now(), reason: `code=${code}` } });
            cleanup();
            if (running && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              const delay = getReconnectDelay();
              reconnectAttempts++;
              ctx.setStatus({ reconnectAttempts });
              console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
              reconnectTimer = setTimeout(() => { reconnectTimer = null; if (running) connect(); }, delay);
            }
          });

          ws.on("error", (err) => {
            ctx.setStatus({ lastError: err.message });
            console.error("[QQ] WebSocket error:", err.message);
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.setStatus({ lastError: errMsg });
          console.error("[QQ] Connection failed:", err);
          if (running && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = getReconnectDelay();
            reconnectAttempts++;
            ctx.setStatus({ reconnectAttempts });
            console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
            reconnectTimer = setTimeout(() => { reconnectTimer = null; if (running) connect(); }, delay);
          }
        }
      };

      const getReconnectDelay = () => {
        const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
        return RECONNECT_DELAYS[idx];
      };

      await connect();

      // Block until shutdown
      return new Promise<void>((resolve) => {
        const shutdown = () => {
          console.log("[QQ] Shutting down...");
          running = false;
          dedup.clear();
          cleanup();
          resolve();
        };
        if (ctx.signal.aborted) { shutdown(); return; }
        ctx.signal.addEventListener("abort", shutdown, { once: true });
      });
    },
  },

  deliver: async (to: string, text: string) => {
    if (!cachedConfig) {
      console.warn("[QQ] deliver() skipped: not configured");
      return;
    }
    const token = await getAccessToken(cachedConfig.appId, cachedConfig.clientSecret);
    if (to.startsWith("qq:group:")) {
      await sendGroupMessage(token, to.slice("qq:group:".length), text);
    } else {
      const openid = to.startsWith("qq:c2c:") ? to.slice("qq:c2c:".length) : to;
      await sendC2CMessage(token, openid, text);
    }
  },
};
