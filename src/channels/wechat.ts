/**
 * WeChat channel plugin for Klaus.
 * Based on @tencent-weixin/openclaw-weixin.
 *
 * Uses long-polling (getUpdates) for message reception.
 * Authentication via QR code scan (no AppID/Secret needed).
 * context_token must be echoed back in every reply.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ChannelPlugin, ChannelContext } from "./types.js";
import type { InboundMessage, MessageType } from "../message.js";
import type { WechatConfig, WechatMessage } from "./wechat-types.js";
import { decryptCred } from "./channel-creds.js";
import { MessageDedup } from "./dedup.js";
import { sleep } from "../retry.js";
import { getUpdates, sendMessageWechat } from "./wechat-api.js";

// ---------------------------------------------------------------------------
// Sync cursor persistence (survives restarts, prevents duplicate messages)
// ---------------------------------------------------------------------------

const SYNC_FILE = join(homedir(), ".klaus", "wechat", "sync.json");

function loadSyncBuf(): string {
  try {
    if (!existsSync(SYNC_FILE)) return "";
    const data = JSON.parse(readFileSync(SYNC_FILE, "utf-8")) as { buf?: string };
    return data.buf ?? "";
  } catch {
    return "";
  }
}

function saveSyncBuf(buf: string): void {
  try {
    const dir = dirname(SYNC_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SYNC_FILE, JSON.stringify({ buf }), "utf-8");
  } catch (err) {
    console.warn("[WeChat] Failed to save sync cursor:", err);
  }
}

// ---------------------------------------------------------------------------
// Context token store (must echo back in every reply)
// ---------------------------------------------------------------------------

const contextTokens = new Map<string, string>();
const CONTEXT_TOKEN_MAX = 10_000;

function setContextToken(senderId: string, token: string): void {
  contextTokens.set(senderId, token);
  if (contextTokens.size > CONTEXT_TOKEN_MAX) {
    const oldest = contextTokens.keys().next().value;
    if (typeof oldest === "string") contextTokens.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

function parseMessageText(msg: WechatMessage): string {
  if (!msg.item_list?.length) return "";

  const parts: string[] = [];
  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === 2) {
      parts.push("[图片]");
    } else if (item.type === 3) {
      if (item.voice_item?.text) {
        parts.push(item.voice_item.text);
      } else {
        parts.push("[语音]");
      }
    } else if (item.type === 4) {
      parts.push(`[文件: ${item.file_item?.file_name || "未知"}]`);
    } else if (item.type === 5) {
      parts.push("[视频]");
    }
  }
  return parts.join("\n").trim();
}

function toMessageType(msg: WechatMessage): MessageType {
  const firstItem = msg.item_list?.[0];
  if (!firstItem) return "text";
  switch (firstItem.type) {
    case 2: return "image";
    case 3: return "voice";
    case 4: return "file";
    case 5: return "video";
    default: return "text";
  }
}

// ---------------------------------------------------------------------------
// Convert WechatMessage → InboundMessage
// ---------------------------------------------------------------------------

function toInboundMessage(msg: WechatMessage): InboundMessage {
  const senderId = msg.from_user_id || "unknown";
  const text = parseMessageText(msg);
  const sessionKey = `wechat:${senderId}`;

  // Store context_token for reply
  if (msg.context_token) {
    setContextToken(senderId, msg.context_token);
  }

  return {
    sessionKey,
    text,
    messageType: toMessageType(msg),
    chatType: "private", // WeChat bot is always 1:1
    senderId,
    timestamp: msg.create_time_ms ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Module-level config cached from last resolveConfig
// ---------------------------------------------------------------------------

let cachedConfig: WechatConfig | undefined;

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const wechatPlugin: ChannelPlugin = {
  meta: {
    id: "wechat",
    label: "WeChat",
    description: "微信机器人，通过二维码扫码登录",
  },

  capabilities: {
    dm: true,
  },

  resolveConfig: (store) => {
    const token = decryptCred(store.get("channel.wechat.token") ?? "");
    const baseUrl = store.get("channel.wechat.base_url");
    const accountId = store.get("channel.wechat.account_id");
    const enabled = store.getBool("channel.wechat.enabled", false);
    if (!enabled || !token || !baseUrl || !accountId) return null;

    cachedConfig = { token, baseUrl, accountId };
    return {
      enabled: true,
      ownerId: store.get("channel.wechat.owner_id") ?? undefined,
      token,
      baseUrl,
      accountId,
    };
  },

  start: async (ctx: ChannelContext) => {
    if (!cachedConfig) throw new Error("WeChat config not resolved");
    const config = cachedConfig;
    const dedup = new MessageDedup();

    console.log("[WeChat] Starting (mode=long-poll)");

    let getUpdatesBuf = loadSyncBuf();
    if (getUpdatesBuf) console.log("[WeChat] Restored sync cursor from disk");

    // Long-poll loop
    while (!ctx.signal.aborted) {
      try {
        const resp = await getUpdates({
          baseUrl: config.baseUrl,
          token: config.token,
          getUpdatesBuf,
        });

        // Session expired
        if (resp.errcode === -14) {
          console.error("[WeChat] Session expired. Please re-login via Settings > Channels.");
          await sleep(3600_000, ctx.signal);
          continue;
        }

        if (resp.get_updates_buf) {
          getUpdatesBuf = resp.get_updates_buf;
          saveSyncBuf(getUpdatesBuf);
        }

        if (!resp.msgs?.length) continue;

        for (const msg of resp.msgs) {
          // Skip bot's own messages
          if (msg.message_type === 2) continue;

          // Dedup
          const dedupeKey = `wechat:${msg.message_id ?? msg.client_id ?? Date.now()}`;
          if (dedup.isDuplicate(dedupeKey)) continue;

          // Process
          void (async () => {
            try {
              const inbound = toInboundMessage(msg);
              if (!inbound.text.trim()) return;

              await ctx.transcript(inbound.sessionKey, "user", inbound.text.trim());
              ctx.notify(inbound.sessionKey, "user", inbound.text.trim());

              const reply = await ctx.handler(inbound);
              if (reply) {
                await ctx.transcript(inbound.sessionKey, "assistant", reply);
                ctx.notify(inbound.sessionKey, "assistant", reply);

                const senderId = msg.from_user_id || "";
                await sendMessageWechat({
                  config,
                  to: senderId,
                  text: reply,
                  contextToken: contextTokens.get(senderId),
                });
              }
            } catch (err) {
              console.error("[WeChat] Error handling message:", err);
            }
          })();
        }
      } catch (err) {
        console.error("[WeChat] Long-poll error:", err);
        await sleep(5000, ctx.signal);
      }
    }

    dedup.clear();
    contextTokens.clear();
  },

  deliver: async (to: string, text: string) => {
    if (!cachedConfig) {
      console.warn("[WeChat] deliver() skipped: not configured");
      return;
    }
    await sendMessageWechat({
      config: cachedConfig,
      to,
      text,
      contextToken: contextTokens.get(to),
    });
  },
};
