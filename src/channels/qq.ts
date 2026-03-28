/**
 * QQ Bot channel plugin for Klaus.
 * Uses QQ Bot Open API v2 with WebSocket gateway for message reception.
 *
 * Supports C2C (private) and group @bot messages.
 * Authentication via AppID + AppSecret from QQ Open Platform.
 */

import WebSocket from "ws";
import type { ChannelPlugin } from "./types.js";
import type { Handler } from "../types.js";
import type { InboundMessage } from "../message.js";
import type { QQBotConfig, WSPayload, C2CMessageEvent, GroupMessageEvent } from "./qq-types.js";
import {
  getAccessToken,
  getGatewayUrl,
  sendC2CMessage,
  sendGroupMessage,
  clearTokenCache,
} from "./qq-api.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let qqConfig: QQBotConfig | undefined;
let transcriptAppend: ((sessionKey: string, role: "user" | "assistant", text: string) => Promise<void>) | undefined;
let notifyWebClients: ((sessionKey: string, role: "user" | "assistant", text: string) => void) | undefined;

export type { QQBotConfig } from "./qq-types.js";

export function setQQBotConfig(config: QQBotConfig): void {
  qqConfig = config;
}

export function setQQBotTranscript(
  append: (sessionKey: string, role: "user" | "assistant", text: string) => Promise<void>,
): void {
  transcriptAppend = append;
}

export function setQQBotNotify(
  notify: (sessionKey: string, role: "user" | "assistant", text: string) => void,
): void {
  notifyWebClients = notify;
}

function getConfig(): QQBotConfig {
  if (!qqConfig) throw new Error("QQ Bot config not set");
  return qqConfig;
}

// ---------------------------------------------------------------------------
// Dedup (in-memory, 60s TTL)
// ---------------------------------------------------------------------------

const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;
const DEDUP_MAX = 10_000;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  if (processedMessages.has(key) && now - processedMessages.get(key)! < DEDUP_TTL_MS) {
    return true;
  }
  processedMessages.set(key, now);
  if (processedMessages.size > DEDUP_MAX) {
    // Evict expired, then oldest if still over limit
    for (const [k, ts] of processedMessages) {
      if (now - ts > DEDUP_TTL_MS || processedMessages.size > DEDUP_MAX) {
        processedMessages.delete(k);
      }
      if (processedMessages.size <= DEDUP_MAX) break;
    }
  }
  return false;
}

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
// Message processing
// ---------------------------------------------------------------------------

async function processMessage(
  handler: Handler,
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
    // Fire transcript write without blocking the handler
    transcriptAppend?.(inbound.sessionKey, "user", cleanContent).catch(() => {});
    notifyWebClients?.(inbound.sessionKey, "user", cleanContent);

    const reply = await handler(inbound);
    if (!reply) return;

    transcriptAppend?.(inbound.sessionKey, "assistant", reply).catch(() => {});
    notifyWebClients?.(inbound.sessionKey, "assistant", reply);

    const token = await getAccessToken(config.appId, config.clientSecret);
    if (type === "group" && groupOpenid) {
      await sendGroupMessage(token, groupOpenid, reply, messageId);
    } else {
      await sendC2CMessage(token, senderId, reply, messageId);
    }
  } catch (err) {
    console.error("[QQ] Error handling message:", err);
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const qqPlugin: ChannelPlugin = {
  meta: {
    id: "qq",
    label: "QQ Bot",
    description: "QQ 机器人，通过 QQ 开放平台 API 连接",
  },

  capabilities: {
    dm: true,
    group: true,
  },

  start: async (handler: Handler) => {
    const config = getConfig();
    console.log("[QQ] Starting (mode=websocket-gateway)");

    let running = true;
    let reconnectAttempts = 0;
    let currentWs: WebSocket | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let sessionId: string | null = null;
    let lastSeq: number | null = null;

    let resolveBlock: (() => void) | null = null;

    const cleanup = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
        currentWs.close();
      }
      currentWs = null;
    };

    const shutdown = () => {
      console.log("[QQ] Shutting down...");
      running = false;
      cleanup();
      resolveBlock?.();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);

    const getReconnectDelay = () => {
      const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
      return RECONNECT_DELAYS[idx];
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
                  console.log(`[QQ] Ready, session: ${sessionId}`);
                } else if (t === "RESUMED") {
                  reconnectAttempts = 0;
                  console.log("[QQ] Session resumed");
                } else if (t === "C2C_MESSAGE_CREATE") {
                  const event = d as C2CMessageEvent;
                  if (!isDuplicate(`qq:c2c:${event.id}`)) {
                    void processMessage(handler, config, {
                      type: "c2c",
                      senderId: event.author.user_openid,
                      content: event.content,
                      messageId: event.id,
                      timestamp: event.timestamp,
                    });
                  }
                } else if (t === "GROUP_AT_MESSAGE_CREATE") {
                  const event = d as GroupMessageEvent;
                  if (!isDuplicate(`qq:group:${event.id}`)) {
                    void processMessage(handler, config, {
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
          cleanup();
          if (running && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = getReconnectDelay();
            reconnectAttempts++;
            console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
            setTimeout(() => { if (running) connect(); }, delay);
          }
        });

        ws.on("error", (err) => {
          console.error("[QQ] WebSocket error:", err.message);
        });
      } catch (err) {
        console.error("[QQ] Connection failed:", err);
        if (running && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();
          reconnectAttempts++;
          console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          setTimeout(() => { if (running) connect(); }, delay);
        }
      }
    };

    await connect();

    // Block forever until shutdown signal
    await new Promise<void>((resolve) => {
      resolveBlock = resolve;
      if (!running) resolve();
    });
  },

  deliver: async (to: string, text: string) => {
    const config = getConfig();
    const token = await getAccessToken(config.appId, config.clientSecret);
    if (to.startsWith("qq:group:")) {
      await sendGroupMessage(token, to.slice("qq:group:".length), text);
    } else {
      const openid = to.startsWith("qq:c2c:") ? to.slice("qq:c2c:".length) : to;
      await sendC2CMessage(token, openid, text);
    }
  },
};
