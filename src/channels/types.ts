/**
 * Channel plugin system — adapter-based architecture aligned with OpenClaw.
 *
 * Each concern (config, gateway, outbound, security, etc.) lives in a
 * separate optional adapter slot on ChannelPlugin.
 */

import type { Handler } from "../types.js";
import type { SettingsStore } from "../settings-store.js";
import type { MediaFile } from "../message.js";

// ---------------------------------------------------------------------------
// Chat types
// ---------------------------------------------------------------------------

export type ChatType = "direct" | "group" | "thread";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type ChannelCapabilities = {
  readonly chatTypes?: ChatType[];
  // Legacy aliases (computed from chatTypes for backward compat)
  readonly dm?: boolean;
  readonly group?: boolean;
  // Media
  readonly image?: boolean;
  readonly file?: boolean;
  readonly audio?: boolean;
  readonly video?: boolean;
  // Interaction
  readonly reply?: boolean;
  readonly emoji?: boolean;
  readonly mention?: boolean;
  readonly reactions?: boolean;
  readonly edit?: boolean;
  readonly unsend?: boolean;
  // Advanced
  readonly threads?: boolean;
  readonly polls?: boolean;
  readonly effects?: boolean;
  readonly groupManagement?: boolean;
  readonly media?: boolean;
  readonly nativeCommands?: boolean;
  readonly blockStreaming?: boolean;
  readonly requiresPublicUrl?: boolean;
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export type ChannelMeta = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly order?: number;
  readonly icon?: string;
  readonly docsUrl?: string;
  readonly aliases?: string[];
};

// ---------------------------------------------------------------------------
// ChannelContext — base runtime context for channels
// ---------------------------------------------------------------------------

export type TranscriptFn = (
  sessionKey: string,
  role: "user" | "assistant",
  text: string,
) => Promise<void>;

export type NotifyFn = (
  sessionKey: string,
  role: "user" | "assistant",
  text: string,
) => void;

export interface ChannelContext {
  readonly handler: Handler;
  readonly transcript: TranscriptFn;
  readonly notify: NotifyFn;
  readonly signal: AbortSignal;
  readonly services?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelAccountSnapshot — rich runtime state per account
// ---------------------------------------------------------------------------

export type ChannelState = "starting" | "running" | "errored" | "stopped";
export type HealthState = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface ChannelAccountSnapshot {
  readonly accountId: string;
  readonly channelId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  running: boolean;
  connected: boolean;
  restartPending: boolean;
  reconnectAttempts: number;
  lastConnectedAt?: number;
  lastDisconnect?: { at: number; reason?: string };
  lastMessageAt?: number;
  lastEventAt?: number;
  lastError?: string;
  healthState: HealthState;
  lastStartAt?: number;
  lastStopAt?: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  busy: boolean;
  activeRuns: number;
  // Transport / credential status
  mode?: string;
  tokenStatus?: string;
  credentialSource?: string;
  webhookUrl?: string;
  baseUrl?: string;
  // Backward-compat
  state: ChannelState;
  restartCount: number;
  startedAt?: number;
}

// ---------------------------------------------------------------------------
// ChannelConfigAdapter — mandatory, replaces resolveConfig
// ---------------------------------------------------------------------------

export interface ChannelConfigAdapter<TAccount = unknown> {
  listAccountIds(store: SettingsStore): Promise<string[]>;
  resolveAccount(store: SettingsStore, accountId?: string): Promise<TAccount | null>;
  isEnabled(account: TAccount, store: SettingsStore): Promise<boolean>;
  isConfigured(account: TAccount, store: SettingsStore): boolean;
}

/**
 * Factory for single-account channels. Only `resolve` differs per channel;
 * listAccountIds, isEnabled, isConfigured share the same logic.
 */
export function singleAccountConfig<T>(
  channelId: string,
  primaryKey: string,
  resolve: (store: SettingsStore) => Promise<T | null>,
): ChannelConfigAdapter<T> {
  return {
    listAccountIds: async (store) => (await store.get(`channel.${channelId}.${primaryKey}`)) ? ["default"] : [],
    resolveAccount: resolve,
    isEnabled: async (_account, store) => store.getBool(`channel.${channelId}.enabled`, false),
    isConfigured: (account) => Boolean(account),
  };
}

// ---------------------------------------------------------------------------
// ChannelGatewayAdapter — replaces start(), richer context
// ---------------------------------------------------------------------------

export interface SendOutboundParams {
  readonly sessionKey: string;
  readonly chatType: ChatType;
  readonly targetId: string;
  readonly text: string;
  readonly replyToMessageId?: string;
  readonly threadId?: string;
}

export interface ChannelGatewayContext<TAccount = unknown> extends ChannelContext {
  readonly accountId: string;
  readonly account: TAccount;
  readonly getStatus: () => ChannelAccountSnapshot;
  readonly setStatus: (patch: Partial<ChannelAccountSnapshot>) => void;
  /** Send via the plugin's outbound adapter. Undefined if no outbound adapter. */
  readonly sendOutbound?: (params: SendOutboundParams) => Promise<OutboundDeliveryResult>;
}

export interface ChannelGatewayAdapter<TAccount = unknown> {
  startAccount(ctx: ChannelGatewayContext<TAccount>): Promise<void>;
  stopAccount?(ctx: ChannelGatewayContext<TAccount>): Promise<void>;
}

// ---------------------------------------------------------------------------
// ChannelOutboundAdapter — framework-level outbound pipeline
// ---------------------------------------------------------------------------

export type DeliveryMode = "direct" | "gateway" | "hybrid";

export interface OutboundContext {
  readonly accountId: string;
  readonly sessionKey: string;
  readonly chatType: ChatType;
  readonly targetId: string;
  readonly replyToMessageId?: string;
  readonly threadId?: string;
  readonly config: unknown;
}

export interface OutboundDeliveryResult {
  readonly messageId?: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ChannelOutboundAdapter {
  readonly deliveryMode: DeliveryMode;
  readonly textChunkLimit?: number;
  readonly chunkerMode?: "text" | "markdown";
  chunker?(text: string, limit: number): string[];
  sendText(ctx: OutboundContext, text: string): Promise<OutboundDeliveryResult>;
  sendMedia?(ctx: OutboundContext, media: MediaFile): Promise<OutboundDeliveryResult>;
  sendPayload?(ctx: OutboundContext, payload: unknown): Promise<OutboundDeliveryResult>;
}

// ---------------------------------------------------------------------------
// ChannelStatusAdapter — health, audit, diagnostics
// ---------------------------------------------------------------------------

export interface ChannelStatusAdapter {
  probeAccount?(params: { accountId: string; config: unknown; timeoutMs?: number }): Promise<{ ok: boolean; error?: string }>;
  auditAccount?(params: { accountId: string; config: unknown }): Promise<Record<string, unknown>>;
  buildAccountSnapshot?(params: { accountId: string; config: unknown; runtime?: ChannelAccountSnapshot }): ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  collectStatusIssues?(accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[];
}

export interface ChannelStatusIssue {
  readonly channelId: string;
  readonly accountId: string;
  readonly kind: "intent" | "permissions" | "config" | "auth" | "runtime";
  readonly message: string;
  readonly fix?: string;
}

// ---------------------------------------------------------------------------
// ChannelSecurityAdapter — DM/group access policies
// ---------------------------------------------------------------------------

export interface ChannelSecurityContext {
  readonly senderId: string;
  readonly chatType: ChatType;
  readonly groupId?: string;
  readonly config: unknown;
}

export interface ChannelSecurityAdapter {
  resolveDmPolicy(ctx: ChannelSecurityContext): "allow" | "deny";
  resolveGroupPolicy?(ctx: ChannelSecurityContext): "allow" | "deny";
  collectWarnings?(ctx: { config: unknown }): string[];
}

// ---------------------------------------------------------------------------
// ChannelAllowlistAdapter — allowlist management
// ---------------------------------------------------------------------------

export interface ChannelAllowlistAdapter {
  readConfig(params: { config: unknown; scope: "dm" | "group" }): {
    entries: Array<string | number>;
    policy?: string;
  };
  applyConfigEdit?(params: {
    config: unknown;
    scope: "dm" | "group";
    action: "add" | "remove";
    entry: string;
  }): { changed: boolean };
  resolveNames?(params: { entries: string[] }): Promise<Map<string, string>>;
  supportsScope?(params: { scope: "dm" | "group" }): boolean;
}

// ---------------------------------------------------------------------------
// ChannelMessagingAdapter — target normalization & session routing
// ---------------------------------------------------------------------------

export interface ChannelOutboundSessionRoute {
  readonly sessionKey: string;
  readonly baseSessionKey?: string;
  readonly chatType: ChatType;
  readonly targetId: string;
  readonly threadId?: string;
}

export interface ChannelMessagingAdapter {
  normalizeTarget?(raw: string): string | undefined;
  resolveOutboundSessionRoute?(params: {
    sessionKey: string;
    chatType: ChatType;
    targetId: string;
    senderId: string;
    threadId?: string;
    config: unknown;
  }): ChannelOutboundSessionRoute | null;
  parseExplicitTarget?(params: { raw: string }): {
    targetId: string;
    threadId?: string;
    chatType?: ChatType;
  } | null;
}

// ---------------------------------------------------------------------------
// ChannelThreadingAdapter — reply-to & threading
// ---------------------------------------------------------------------------

export type ReplyToMode = "reply" | "thread" | "none";

export interface ChannelThreadingAdapter {
  resolveReplyToMode?(params: { chatType: ChatType; config: unknown; groupId?: string }): ReplyToMode;
  resolveAutoThreadId?(params: {
    messageId: string;
    rootId?: string;
    threadId?: string;
  }): string | null;
  resolveReplyTransport?(params: {
    replyToMessageId?: string;
    threadId?: string;
    replyInThread: boolean;
  }): unknown;
}

// ---------------------------------------------------------------------------
// ChannelGroupAdapter — group-specific policies
// ---------------------------------------------------------------------------

export interface ChannelGroupContext {
  readonly groupId: string;
  readonly senderId?: string;
  readonly config: unknown;
}

export interface ChannelGroupAdapter {
  resolveRequireMention(params: ChannelGroupContext): boolean;
  resolveGroupToolPolicy?(params: ChannelGroupContext): unknown;
}

// ---------------------------------------------------------------------------
// ChannelMentionAdapter — mention stripping & normalization
// ---------------------------------------------------------------------------

export interface ChannelMentionContext {
  readonly mentions?: unknown[];
  readonly botId?: string;
}

export interface ChannelMentionAdapter {
  stripMentions(text: string, ctx: ChannelMentionContext): string;
}

// ---------------------------------------------------------------------------
// ChannelStreamingAdapter — streaming response config
// ---------------------------------------------------------------------------

export interface ChannelStreamingAdapter {
  readonly blockStreamingCoalesceDefaults?: {
    readonly minChars: number;
    readonly idleMs: number;
  };
}

// ---------------------------------------------------------------------------
// ChannelLifecycleAdapter — config change & removal hooks
// ---------------------------------------------------------------------------

export interface ChannelLifecycleAdapter {
  onAccountConfigChanged?(params: { accountId: string; config: unknown }): Promise<void> | void;
  onAccountRemoved?(params: { accountId: string }): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// ChannelConfigSchema — schema-driven config for admin UI
// ---------------------------------------------------------------------------

export interface ChannelConfigField {
  readonly key: string;
  readonly type: "string" | "secret" | "boolean";
  readonly label: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly help?: string;
}

export interface ChannelConfigSchema {
  readonly fields: readonly ChannelConfigField[];
  /** Validate credentials before saving. Return meta to store alongside config. */
  readonly probe?: (config: Record<string, string>) => Promise<{
    ok: boolean;
    error?: string;
    meta?: Record<string, string>;
  }>;
  /** Extra SettingsStore keys to clear on DELETE (beyond field keys + enabled). */
  readonly deleteKeys?: readonly string[];
}

// ---------------------------------------------------------------------------
// ChannelPlugin — the core contract with all adapter slots
// ---------------------------------------------------------------------------

export type ChannelPlugin<TAccount = any> = {
  readonly meta: ChannelMeta;
  readonly capabilities: ChannelCapabilities;

  readonly config?: ChannelConfigAdapter<TAccount>;
  readonly gateway?: ChannelGatewayAdapter<TAccount>;
  readonly outbound?: ChannelOutboundAdapter;
  readonly status?: ChannelStatusAdapter;
  readonly security?: ChannelSecurityAdapter;
  readonly allowlist?: ChannelAllowlistAdapter;
  readonly messaging?: ChannelMessagingAdapter;
  readonly threading?: ChannelThreadingAdapter;
  readonly groups?: ChannelGroupAdapter;
  readonly mentions?: ChannelMentionAdapter;
  readonly streaming?: ChannelStreamingAdapter;
  readonly lifecycle?: ChannelLifecycleAdapter;
  readonly configSchema?: ChannelConfigSchema;

  /** Proactively send a message (used by cron scheduler). */
  readonly deliver?: (to: string, text: string) => Promise<void>;

  /** Optional skill directories bundled with this channel plugin. */
  readonly skillDirs?: readonly string[];
};
