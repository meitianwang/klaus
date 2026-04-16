/**
 * Telegram Bot channel plugin for Klaus.
 *
 * Uses grammy for Bot API with long-polling for message reception.
 * Supports private chats, groups (@mention required), and forum topics.
 */

import { Bot, GrammyError, type Context } from "grammy";
import { singleAccountConfig, type ChannelPlugin } from "./types.js";
import { decryptCred } from "./channel-creds.js";
import { MessageDedup } from "./dedup.js";
import type { InboundMessage, MessageType } from "../message.js";
import type { TelegramConfig, TelegramMessage } from "./telegram-types.js";

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

function extractText(msg: TelegramMessage): { text: string; messageType: MessageType } {
  if (msg.text) return { text: msg.text, messageType: "text" };
  if (msg.caption) return { text: msg.caption, messageType: "text" };
  if (msg.photo?.length) return { text: "[图片]", messageType: "image" };
  if (msg.document) return { text: `[文件: ${msg.document.file_name ?? "file"}]`, messageType: "file" };
  if (msg.voice) return { text: "[语音]", messageType: "voice" };
  if (msg.video) return { text: "[视频]", messageType: "video" };
  if (msg.sticker) return { text: msg.sticker.emoji ?? "[贴纸]", messageType: "emoji" };
  return { text: "", messageType: "text" };
}

function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function buildSessionKey(msg: TelegramMessage): string {
  const chatId = msg.chat.id;
  if (!isGroupChat(msg.chat.type)) {
    // DM: use sender ID for isolation
    return `telegram:${msg.from?.id ?? chatId}`;
  }
  // Group: use chat ID, optionally with topic
  if (msg.message_thread_id && msg.chat.is_forum) {
    return `telegram:${chatId}:topic:${msg.message_thread_id}`;
  }
  return `telegram:${chatId}`;
}

// ---------------------------------------------------------------------------
// @mention detection in groups
// ---------------------------------------------------------------------------

function isBotMentioned(text: string, botUsername: string): boolean {
  if (!botUsername) return false;
  const mention = `@${botUsername}`;
  return text.toLowerCase().includes(mention.toLowerCase());
}

function stripBotMention(text: string, botUsername: string): string {
  if (!botUsername) return text;
  return text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "").trim();
}

// ---------------------------------------------------------------------------
// Text chunking (Telegram limit: 4096 chars)
// ---------------------------------------------------------------------------

const TELEGRAM_TEXT_LIMIT = 4096;

function chunkText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    if (splitAt < limit * 0.3) {
      splitAt = remaining.lastIndexOf("\n", limit);
    }
    if (splitAt < limit * 0.3) {
      splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Module state for deliver()
// ---------------------------------------------------------------------------

let activeBot: Bot | undefined;

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const telegramPlugin: ChannelPlugin<TelegramConfig> = {
  meta: {
    id: "telegram",
    label: "Telegram",
    description: "Telegram Bot，通过 Bot API 长轮询接收消息",
    order: 6,
    icon: "telegram",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
    reply: true,
    mention: true,
    threads: true,
    emoji: true,
  },

  config: singleAccountConfig<TelegramConfig>("telegram", "bot_token", (store) => {
    const botToken = decryptCred(store.get("channel.telegram.bot_token") ?? "");
    return botToken ? { botToken } : null;
  }),

  configSchema: {
    fields: [
      { key: "bot_token", type: "secret", label: "Bot Token", required: true, placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", help: "从 @BotFather 获取" },
    ],
    async probe(config) {
      try {
        const bot = new Bot(config.bot_token!);
        const me = await bot.api.getMe();
        return { ok: true, meta: { bot_username: me.username, bot_name: me.first_name } };
      } catch (err) {
        const msg = err instanceof GrammyError ? err.description : String(err);
        return { ok: false, error: msg };
      }
    },
    deleteKeys: ["owner_id", "bot_username", "bot_name"],
  },

  status: {
    async probeAccount(params) {
      const config = params.config as TelegramConfig;
      try {
        const bot = new Bot(config.botToken);
        await bot.api.getMe();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof GrammyError ? err.description : String(err) };
      }
    },
  },

  groups: {
    resolveRequireMention: () => true,
  },

  mentions: {
    stripMentions: (text, ctx) => {
      if (!ctx.botId) return text;
      return stripBotMention(text, ctx.botId);
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: TELEGRAM_TEXT_LIMIT,
    chunkerMode: "markdown",
    chunker: chunkText,
    async sendText(ctx, text) {
      if (!activeBot) return { ok: false, error: "Bot not running" };
      try {
        const chatId = Number(ctx.targetId) || ctx.targetId;
        const opts: Record<string, unknown> = {};
        if (ctx.replyToMessageId) {
          opts.reply_to_message_id = Number(ctx.replyToMessageId);
        }
        if (ctx.threadId) {
          opts.message_thread_id = Number(ctx.threadId);
        }
        const sent = await activeBot.api.sendMessage(chatId, text, opts);
        return { ok: true, messageId: String(sent.message_id) };
      } catch (err) {
        return { ok: false, error: err instanceof GrammyError ? err.description : String(err) };
      }
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const config = ctx.account;
      const dedup = new MessageDedup();

      console.log("[Telegram] Starting (mode=polling)");

      const bot = new Bot(config.botToken);

      // Validate token before assigning activeBot
      const me = await bot.api.getMe();
      activeBot = bot;
      const botUsername = me.username;
      ctx.setStatus({ connected: true, lastConnectedAt: Date.now(), mode: "polling", tokenStatus: "valid", name: me.first_name });
      console.log(`[Telegram] Bot identity: @${botUsername} (${me.first_name})`);

      // Per-session message queue to prevent concurrent agent calls
      const sessionQueues = new Map<string, Promise<void>>();

      // Handle all messages
      bot.on("message", (grammyCtx: Context) => {
        const msg = grammyCtx.message as TelegramMessage | undefined;
        if (!msg) return;

        // Dedup
        const dedupeKey = `telegram:${msg.chat.id}:${msg.message_id}`;
        if (dedup.isDuplicate(dedupeKey)) return;

        // Skip bot's own messages
        if (msg.from?.id === me.id) return;

        const { text, messageType } = extractText(msg);
        if (!text.trim()) return;

        const isGroup = isGroupChat(msg.chat.type);

        // In groups, only respond when bot is @mentioned
        if (isGroup && !isBotMentioned(text, botUsername)) return;

        // Strip bot @mention from text
        const cleanText = isGroup ? stripBotMention(text, botUsername) : text;
        if (!cleanText.trim()) return;

        const sessionKey = buildSessionKey(msg);
        const senderId = String(msg.from?.id ?? "unknown");
        const senderName = msg.from
          ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
          : undefined;

        const preview = cleanText.slice(0, 50);
        console.log(`[Telegram] Inbound: from=${senderName ?? senderId} chatType=${msg.chat.type} text="${preview}"`);

        ctx.setStatus({ lastInboundAt: Date.now() });

        const inbound: InboundMessage = {
          sessionKey,
          text: cleanText,
          messageType,
          chatType: isGroup ? "group" : "private",
          senderId,
          senderName,
          timestamp: Date.now(),
        };

        // Queue messages per session to avoid "Agent is already running" errors
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
                  targetId: String(msg.chat.id),
                  text: reply,
                  replyToMessageId: String(msg.message_id),
                  threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
                });
              } else {
                console.error("[Telegram] No outbound adapter — reply dropped");
              }
            }
          } catch (err) {
            console.error("[Telegram] Error handling message:", err);
          }
        });
        const tracked = task.catch(() => {});
        sessionQueues.set(sessionKey, tracked);
        tracked.finally(() => { if (sessionQueues.get(sessionKey) === tracked) sessionQueues.delete(sessionKey); });
      });

      // Error handler
      bot.catch((err) => {
        ctx.setStatus({ lastError: String(err.message ?? err) });
        console.error("[Telegram] Bot error:", err.message);
      });

      // Start polling (fire-and-forget with error handling)
      let stopped = false;
      bot.start({
        drop_pending_updates: true,
        allowed_updates: ["message"],
        onStart: () => {
          console.log("[Telegram] Polling started");
        },
      }).catch((err) => {
        if (!stopped) {
          console.error("[Telegram] Polling error:", err);
          ctx.setStatus({ lastError: String(err) });
        }
      });

      // Block until abort signal
      return new Promise<void>((resolve) => {
        const shutdown = () => {
          if (stopped) return;
          stopped = true;
          console.log("[Telegram] Shutting down...");
          activeBot = undefined;
          dedup.clear();
          bot.stop().catch(() => {});
          resolve();
        };
        if (ctx.signal.aborted) { shutdown(); return; }
        ctx.signal.addEventListener("abort", shutdown, { once: true });
      });
    },
  },
};
