/**
 * Channel plugin system: composition over inheritance.
 * Inspired by OpenClaw's ChannelPlugin adapter architecture.
 */

import type { Handler } from "../types.js";
import type { SettingsStore } from "../settings-store.js";

// ---------------------------------------------------------------------------
// Capabilities — explicitly declares what a channel supports
// ---------------------------------------------------------------------------

export type ChannelCapabilities = {
  readonly dm?: boolean;
  readonly group?: boolean;
  readonly image?: boolean;
  readonly file?: boolean;
  readonly audio?: boolean;
  readonly video?: boolean;
  readonly reply?: boolean;
  readonly emoji?: boolean;
  readonly mention?: boolean;
  readonly requiresPublicUrl?: boolean;
};

// ---------------------------------------------------------------------------
// Meta — human-readable identity for setup wizard, doctor, etc.
// ---------------------------------------------------------------------------

export type ChannelMeta = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
};

// ---------------------------------------------------------------------------
// ChannelContext — everything a channel needs at runtime
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
  /** Extra services (e.g. web channel needs stores, agentManager, etc.) */
  readonly services?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelResolvedConfig — result of resolveConfig()
// ---------------------------------------------------------------------------

export interface ChannelResolvedConfig {
  readonly enabled: boolean;
  readonly ownerId?: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ChannelPlugin — the core contract
// ---------------------------------------------------------------------------

export type ChannelPlugin = {
  readonly meta: ChannelMeta;
  readonly capabilities: ChannelCapabilities;

  /**
   * Resolve channel-specific config from SettingsStore.
   * Return null if not configured or not enabled.
   */
  readonly resolveConfig: (store: SettingsStore) => ChannelResolvedConfig | null;

  /**
   * Start the channel. Should resolve when signal is aborted or
   * the channel stops for any other reason.
   */
  readonly start: (ctx: ChannelContext) => Promise<void>;

  /**
   * Proactively send a message to a user/target. Optional — not all channels
   * support unsolicited messages.
   * Used by cron scheduler for result delivery.
   */
  readonly deliver?: (to: string, text: string) => Promise<void>;

  /**
   * Health probe: verify credentials and connectivity.
   */
  readonly probe?: () => Promise<{ ok: boolean; error?: string }>;
};

// ---------------------------------------------------------------------------
// Channel status (tracked by ChannelManager)
// ---------------------------------------------------------------------------

export type ChannelState = "starting" | "running" | "errored" | "stopped";

export interface ChannelStatus {
  state: ChannelState;
  lastError?: string;
  restartCount: number;
  startedAt?: number;
}

