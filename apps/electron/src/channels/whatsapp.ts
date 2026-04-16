/**
 * WhatsApp channel plugin for Klaus.
 *
 * Uses Baileys (WhatsApp Web client library) with QR code authentication.
 * Supports private chats and group messages.
 *
 * Auth: QR code scan from WhatsApp mobile app.
 * Credentials persisted to ~/.klaus/whatsapp/ for session resumption.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { singleAccountConfig, type ChannelPlugin } from "./types.js";
import { MessageDedup } from "./dedup.js";
import type { InboundMessage } from "../message.js";
import type { WhatsAppConfig } from "./whatsapp-types.js";

// Default auth directory
const DEFAULT_AUTH_DIR = join(homedir(), ".klaus", "whatsapp");

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let activeSock: ReturnType<typeof import("@whiskeysockets/baileys").default> | undefined;
/** Pending QR string for admin UI polling. Null when connected or not started. */
let pendingQr: string | null = null;
let waConnected = false;

export function getWhatsAppQrStatus(): { qr: string | null; connected: boolean } {
  return { qr: pendingQr, connected: waConnected };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

function jidToSessionKey(jid: string): string {
  // Strip @s.whatsapp.net or @g.us suffix for cleaner session keys
  const clean = jid.replace(/@s\.whatsapp\.net$/, "").replace(/@g\.us$/, ":group");
  return `whatsapp:${clean}`;
}

function extractText(msg: any): string {
  if (!msg) return "";
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  if (msg.imageMessage) return "[图片]";
  if (msg.videoMessage) return "[视频]";
  if (msg.audioMessage) return "[语音]";
  if (msg.documentMessage) return `[文件: ${msg.documentMessage.fileName ?? "file"}]`;
  if (msg.stickerMessage) return "[贴纸]";
  if (msg.contactMessage) return "[联系人]";
  if (msg.locationMessage) return "[位置]";
  return "";
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const whatsappPlugin: ChannelPlugin<WhatsAppConfig> = {
  meta: {
    id: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp 消息（通过 Baileys 库，需扫码登录）",
    order: 8,
    icon: "whatsapp",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
  },

  config: singleAccountConfig<WhatsAppConfig>("whatsapp", "auth_dir", (store) => {
    const authDir = store.get("channel.whatsapp.auth_dir") ?? DEFAULT_AUTH_DIR;
    return { authDir };
  }),

  // WhatsApp uses QR code login — no simple configSchema fields
  // The admin panel has a custom QR flow (like WeChat)

  outbound: {
    deliveryMode: "direct",
    async sendText(ctx, text) {
      if (!activeSock) return { ok: false, error: "WhatsApp not connected" };
      try {
        // Reconstruct JID from targetId
        let jid = ctx.targetId;
        if (!jid.includes("@")) {
          jid = ctx.chatType === "group" ? `${jid}@g.us` : `${jid}@s.whatsapp.net`;
        }
        const sent = await activeSock.sendMessage(jid, { text });
        return { ok: true, messageId: sent?.key?.id ?? undefined };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const config = ctx.account;
      const authDir = config.authDir || DEFAULT_AUTH_DIR;
      mkdirSync(authDir, { recursive: true, mode: 0o700 });

      const dedup = new MessageDedup();
      const sessionQueues = new Map<string, Promise<void>>();
      let rejectBlocker: ((err: Error) => void) | undefined;

      console.log("[WhatsApp] Starting...");

      // Dynamic import to avoid loading Baileys at startup for non-WhatsApp users
      const baileys = await import("@whiskeysockets/baileys");
      const makeWASocket = baileys.default;
      const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Klaus", "Desktop", "1.0.0"],
        generateHighQualityLinkPreview: false,
      });
      activeSock = sock;

      // Save credentials on update
      sock.ev.on("creds.update", saveCreds);

      // Connection state
      sock.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          pendingQr = qr;
          console.log("[WhatsApp] QR code ready for scanning");
        }

        if (connection === "open") {
          pendingQr = null;
          waConnected = true;
          ctx.setStatus({ connected: true, lastConnectedAt: Date.now(), mode: "websocket", tokenStatus: "valid" });
          console.log("[WhatsApp] Connected");
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          ctx.setStatus({ connected: false, lastDisconnect: { at: Date.now(), reason: String(statusCode) } });

          if (statusCode === DisconnectReason.loggedOut) {
            console.error("[WhatsApp] Logged out — need to re-scan QR");
            ctx.setStatus({ lastError: "Logged out. Re-scan QR code." });
          } else {
            console.log(`[WhatsApp] Disconnected (code=${statusCode}), will restart via ChannelManager`);
            // Reject the blocking promise to trigger ChannelManager's auto-restart
            rejectBlocker?.(new Error(`WhatsApp disconnected: ${statusCode}`));
          }
        }
      });

      // Handle inbound messages
      sock.ev.on("messages.upsert", (upsert: any) => {
        if (upsert.type !== "notify") return;

        for (const waMsg of upsert.messages) {
          // Skip status broadcasts
          if (waMsg.key.remoteJid === "status@broadcast") continue;
          // Skip own messages
          if (waMsg.key.fromMe) continue;

          const jid = waMsg.key.remoteJid;
          if (!jid) continue;

          const dedupeKey = `whatsapp:${waMsg.key.id}`;
          if (dedup.isDuplicate(dedupeKey)) continue;

          const text = extractText(waMsg.message);
          if (!text.trim()) continue;

          const isGroup = isGroupJid(jid);
          const senderId = isGroup
            ? (waMsg.key.participant ?? jid)
            : jid;
          const sessionKey = jidToSessionKey(jid);
          const cleanText = text.trim();

          const senderName = waMsg.pushName ?? undefined;
          const preview = cleanText.slice(0, 50);
          console.log(`[WhatsApp] Inbound: from=${senderName ?? senderId} group=${isGroup} text="${preview}"`);

          ctx.setStatus({ lastInboundAt: Date.now() });

          const inbound: InboundMessage = {
            sessionKey,
            text: cleanText,
            messageType: "text",
            chatType: isGroup ? "group" : "private",
            senderId: senderId.replace(/@s\.whatsapp\.net$/, ""),
            senderName,
            timestamp: waMsg.messageTimestamp ? Number(waMsg.messageTimestamp) * 1000 : Date.now(),
          };

          const prev = sessionQueues.get(sessionKey) ?? Promise.resolve();
          const task = prev.then(async () => {
            try {
              await ctx.transcript(sessionKey, "user", cleanText);
              ctx.notify(sessionKey, "user", cleanText);

              const reply = await ctx.handler(inbound);
              if (reply) {
                await ctx.transcript(sessionKey, "assistant", reply);
                ctx.notify(sessionKey, "assistant", reply);
                ctx.setStatus({ lastOutboundAt: Date.now() });

                if (ctx.sendOutbound) {
                  await ctx.sendOutbound({
                    sessionKey,
                    chatType: isGroup ? "group" : "direct",
                    targetId: jid,
                    text: reply,
                  });
                } else {
                  console.error("[WhatsApp] No outbound adapter — reply dropped");
                }
              }
            } catch (err) {
              console.error("[WhatsApp] Error handling message:", err);
            }
          });
          const tracked = task.catch(() => {});
          sessionQueues.set(sessionKey, tracked);
          tracked.finally(() => { if (sessionQueues.get(sessionKey) === tracked) sessionQueues.delete(sessionKey); });
        }
      });

      // Block until abort signal or disconnect
      return new Promise<void>((resolve, reject) => {
        rejectBlocker = reject;
        const shutdown = () => {
          console.log("[WhatsApp] Shutting down...");
          activeSock = undefined;
          pendingQr = null;
          waConnected = false;
          dedup.clear();
          sock.end(undefined);
          resolve();
        };
        if (ctx.signal.aborted) { shutdown(); return; }
        ctx.signal.addEventListener("abort", shutdown, { once: true });
      });
    },

    stopAccount: async () => {
      if (activeSock) {
        activeSock.end(undefined);
        activeSock = undefined;
      }
    },
  },
};
