/**
 * Feishu/Lark channel type definitions.
 * Aligned with OpenClaw's extensions/feishu/src/types.ts
 */

// ---------------------------------------------------------------------------
// Domain & connection
// ---------------------------------------------------------------------------

export type FeishuDomain = "feishu" | "lark" | (string & {});
export type FeishuConnectionMode = "websocket" | "webhook";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FeishuConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly domain?: FeishuDomain;
  readonly connectionMode?: FeishuConnectionMode;
  /** Webhook-only: encrypt key for signature verification */
  readonly encryptKey?: string;
  /** Webhook-only: verification token */
  readonly verificationToken?: string;
  readonly webhookPort?: number;
  readonly webhookHost?: string;
  readonly webhookPath?: string;
  /** HTTP request timeout in ms (default 30_000, max 300_000) */
  readonly httpTimeoutMs?: number;

  // --- Access control ---
  /** DM policy: "open" | "pairing" | "allowlist" (default "pairing") */
  readonly dmPolicy?: "open" | "pairing" | "allowlist";
  /** Group policy: "open" | "allowlist" | "disabled" (default "allowlist") */
  readonly groupPolicy?: "open" | "allowlist" | "disabled";
  /** Global allowlist for DMs (string IDs) */
  readonly allowFrom?: readonly (string | number)[];
  /** Global allowlist for groups */
  readonly groupAllowFrom?: readonly (string | number)[];
  /** Per-sender allowlist within groups */
  readonly groupSenderAllowFrom?: readonly (string | number)[];
  /** Require @mention in group chats (default true) */
  readonly requireMention?: boolean;

  // --- Group session routing ---
  /** "group" | "group_sender" | "group_topic" | "group_topic_sender" */
  readonly groupSessionScope?: GroupSessionScope;
  /** @deprecated Use groupSessionScope. "disabled" | "enabled" */
  readonly topicSessionMode?: "disabled" | "enabled";
  /** "disabled" | "enabled" — replies create/continue topic threads */
  readonly replyInThread?: "disabled" | "enabled";

  // --- Per-group overrides ---
  readonly groups?: Record<string, FeishuGroupConfig | undefined>;

  // --- Feature toggles ---
  /** Render mode for outbound messages: "auto" | "raw" | "card" */
  readonly renderMode?: "auto" | "raw" | "card";
  /** Use Feishu CardKit streaming for incremental display */
  readonly streaming?: boolean;
  /** Enable typing indicators via emoji reactions (default true) */
  readonly typingIndicator?: boolean;
  /** Resolve sender display names via API (default true) */
  readonly resolveSenderNames?: boolean;
  /** Reaction notification mode: "off" | "own" | "all" (default "own") */
  readonly reactionNotifications?: "off" | "own" | "all";
  /** Markdown rendering: "native" | "escape" | "strip" */
  readonly markdown?: { mode?: string; tableMode?: string };
}

export interface FeishuGroupConfig {
  readonly requireMention?: boolean;
  readonly enabled?: boolean;
  readonly allowFrom?: readonly (string | number)[];
  readonly systemPrompt?: string;
  readonly groupSessionScope?: GroupSessionScope;
  readonly topicSessionMode?: "disabled" | "enabled";
  readonly replyInThread?: "disabled" | "enabled";
}

// ---------------------------------------------------------------------------
// Group session scope
// ---------------------------------------------------------------------------

export type GroupSessionScope =
  | "group"
  | "group_sender"
  | "group_topic"
  | "group_topic_sender";

// ---------------------------------------------------------------------------
// Message context
// ---------------------------------------------------------------------------

export type FeishuMessageEvent = {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    chat_id: string;
    chat_type: "p2p" | "group" | "private";
    message_type: string;
    content: string;
    create_time?: string;
    mentions?: FeishuMention[];
  };
};

export type FeishuMention = {
  key: string;
  id: { open_id?: string; user_id?: string; union_id?: string };
  name: string;
  tenant_key?: string;
};

export type FeishuBotAddedEvent = {
  chat_id: string;
  operator_id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  external: boolean;
  operator_tenant_key?: string;
};

export type FeishuMessageContext = {
  chatId: string;
  messageId: string;
  senderId: string;
  senderOpenId: string;
  senderName?: string;
  chatType: "p2p" | "group" | "private";
  mentionedBot: boolean;
  hasAnyMention?: boolean;
  rootId?: string;
  parentId?: string;
  threadId?: string;
  content: string;
  contentType: string;
};

// ---------------------------------------------------------------------------
// Send result
// ---------------------------------------------------------------------------

export type FeishuSendResult = {
  messageId: string;
  chatId: string;
};

export type FeishuChatType = "p2p" | "group" | "private";

export type FeishuMessageInfo = {
  messageId: string;
  chatId: string;
  chatType?: FeishuChatType;
  senderId?: string;
  senderOpenId?: string;
  senderType?: string;
  content: string;
  contentType: string;
  createTime?: number;
  threadId?: string;
};

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type FeishuMediaInfo = {
  path: string;
  contentType?: string;
  placeholder: string;
};

// ---------------------------------------------------------------------------
// Permission error
// ---------------------------------------------------------------------------

export type FeishuPermissionError = {
  code: number;
  message: string;
  grantUrl?: string;
};
