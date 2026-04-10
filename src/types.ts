import type { InboundMessage } from "./message.js";

/** Handler signature: receives a structured InboundMessage, returns reply text (null = skip reply). */
export type Handler = (
  msg: InboundMessage,
) => Promise<string | null>;

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface WebConfig {
  readonly port: number;
  readonly sessionMaxAgeDays: number;
  readonly google?: GoogleOAuthConfig;
  /** Explicit public base URL (e.g. "https://example.com") for OAuth callbacks. */
  readonly publicBaseUrl?: string;
}

export interface TranscriptsConfig {
  readonly transcriptsDir: string;
  readonly maxFiles: number;
  readonly maxAgeDays: number;
}

// ---------------------------------------------------------------------------
// Cron (scheduled tasks)
// ---------------------------------------------------------------------------

export type CronScheduleType =
  | { readonly kind: "cron"; readonly expr: string; readonly tz?: string }
  | { readonly kind: "every"; readonly intervalMs: number }
  | { readonly kind: "at"; readonly at: string };

export interface CronFailureDestination {
  readonly channel?: string;
  readonly to?: string;
  readonly accountId?: string;
  readonly mode?: "announce" | "webhook";
}

export interface CronDelivery {
  readonly channel: string;
  readonly to?: string;
  readonly mode?: "announce" | "webhook" | "none";
  readonly bestEffort?: boolean;
  readonly accountId?: string;
  readonly failureDestination?: CronFailureDestination;
}

export interface CronRetryConfig {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[];
  readonly retryOn: readonly string[];
}

export interface CronFailureAlert {
  readonly enabled: boolean;
  readonly after: number;
  readonly cooldownMs: number;
  readonly channel?: string;
  readonly to?: string;
  readonly mode?: "announce" | "webhook";
  readonly webhookUrl?: string;
  readonly webhookToken?: string;
}

export interface CronRunLogConfig {
  readonly maxBytes: number;
  readonly keepLines: number;
}

export interface CronTask {
  readonly id: string;
  readonly userId?: string;
  readonly name?: string;
  readonly description?: string;
  readonly schedule: string | CronScheduleType;
  readonly prompt: string;
  readonly fallbacks?: readonly string[];
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high";
  readonly lightContext?: boolean;
  readonly enabled?: boolean;
  readonly deleteAfterRun?: boolean;
  readonly timeoutSeconds?: number;
  readonly staggerMs?: number;
  readonly deliver?: CronDelivery;
  readonly webhookUrl?: string;
  readonly webhookToken?: string;
  readonly failureAlert?: CronFailureAlert | false;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export interface CronConfig {
  readonly enabled: boolean;
  readonly tasks: readonly CronTask[];
  readonly webhookToken?: string;
  readonly retry?: CronRetryConfig;
  readonly sessionRetentionMs?: number;
  readonly runLog?: CronRunLogConfig;
  readonly failureAlert?: CronFailureAlert;
  readonly maxConcurrentRuns?: number;
  readonly failureDestination?: CronFailureDestination;
  readonly storePath?: string;
}

// ---------------------------------------------------------------------------
// Cron runtime types (used by CronScheduler + CLI)
// ---------------------------------------------------------------------------

export interface CronRunRecord {
  readonly taskId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly status: "ok" | "error" | "skipped";
  readonly resultPreview?: string;
  readonly error?: string;
}

export interface CronTaskStatus {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly schedule: string;
  readonly enabled: boolean;
  readonly nextRun: string | null;
  readonly lastRun: CronRunRecord | null;
  readonly consecutiveErrors: number;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export interface CronSchedulerStatus {
  readonly running: boolean;
  readonly taskCount: number;
  readonly activeJobs: number;
  readonly runningTasks: number;
  readonly maxConcurrentRuns: number | null;
  readonly nextWakeAt: string | null;
}
