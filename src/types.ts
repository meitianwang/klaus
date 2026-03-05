import type { InboundMessage } from "./message.js";
import type { ToolEvent } from "./tool-config.js";

/** Callback invoked when Claude uses a tool (optional, used by Web channel). */
export type ToolEventCallback = (event: ToolEvent) => void;

/** Callback for streaming text chunks (optional, used by Web channel). */
export type StreamChunkCallback = (chunk: string) => void;

/** A permission request sent to the browser for user approval. */
export interface PermissionRequest {
  readonly requestId: string;
  readonly toolName: string;
  readonly toolUseId: string;
  readonly input: Record<string, unknown>;
  readonly description?: string;
  readonly display: {
    readonly icon: string;
    readonly label: string;
    readonly style: string;
    readonly value: string;
    readonly secondary?: string;
  };
}

/** Callback for interactive tool permission approval (optional, used by Web channel). */
export type PermissionRequestCallback = (
  request: PermissionRequest,
) => Promise<{ allow: boolean }>;

/** Handler signature: receives a structured InboundMessage, returns reply text (null = merged, skip reply). */
export type Handler = (
  msg: InboundMessage,
  onToolEvent?: ToolEventCallback,
  onStreamChunk?: StreamChunkCallback,
  onPermissionRequest?: PermissionRequestCallback,
) => Promise<string | null>;

export interface QQBotConfig {
  readonly appid: string;
  readonly secret: string;
}

export interface WeComConfig {
  readonly corpId: string;
  readonly corpSecret: string;
  readonly agentId: number;
  readonly token: string;
  readonly encodingAesKey: string;
  readonly port: number;
}

// ---------------------------------------------------------------------------
// Tunnel provider configs (discriminated union)
// ---------------------------------------------------------------------------

export interface QuickTunnelConfig {
  readonly provider: "cloudflare-quick";
}

export interface NamedTunnelConfig {
  readonly provider: "cloudflare";
  readonly token: string;
  readonly hostname?: string;
}

export interface NgrokTunnelConfig {
  readonly provider: "ngrok";
  readonly authtoken: string;
  readonly domain?: string;
}

export interface CustomTunnelConfig {
  readonly provider: "custom";
  readonly url: string;
  readonly command?: string;
}

export type TunnelConfig =
  | QuickTunnelConfig
  | NamedTunnelConfig
  | NgrokTunnelConfig
  | CustomTunnelConfig;

export interface WebConfig {
  readonly token: string;
  readonly port: number;
  readonly tunnel: TunnelConfig | false;
  readonly permissions: boolean;
}

export interface SessionConfig {
  readonly idleMs: number;
  readonly maxEntries: number;
  readonly maxAgeMs: number;
}

export interface TranscriptsConfig {
  readonly transcriptsDir: string;
  readonly maxFiles: number;
  readonly maxAgeDays: number;
}

export interface KlausConfig {
  channel: string;
  persona?: string;
  qq?: QQBotConfig;
  wecom?: WeComConfig;
  web?: WebConfig;
  session?: SessionConfig;
  transcripts?: TranscriptsConfig;
}
