/**
 * Telegram Bot channel types.
 */

export type TelegramConfig = {
  botToken: string;
};

/** Subset of Telegram Update.message we care about. */
export type TelegramMessage = {
  message_id: number;
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    is_forum?: boolean;
  };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    is_bot?: boolean;
  };
  text?: string;
  caption?: string;
  message_thread_id?: number;
  reply_to_message?: TelegramMessage;
  photo?: unknown[];
  document?: { file_name?: string };
  voice?: unknown;
  video?: unknown;
  sticker?: { emoji?: string };
};
