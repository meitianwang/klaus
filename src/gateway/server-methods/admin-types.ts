import type { CronTask, CronTaskStatus, CronSchedulerStatus } from "../../types.js";

export type CronSchedulerLike = {
  getStatus(): readonly CronTaskStatus[];
  getSchedulerStatus(): CronSchedulerStatus;
  addTask(task: CronTask): void;
  editTask(id: string, patch: Partial<CronTask>): boolean;
  removeTask(id: string): boolean;
  runTask(id: string): Promise<unknown>;
};

export type GatewaySettingsSnapshot = {
  readonly max_sessions: number;
  readonly yolo: boolean;
  readonly permission_mode: string;
  readonly web: {
    readonly session_max_age_days: number;
  };
  readonly transcripts: {
    readonly max_files: number;
    readonly max_age_days: number;
  };
  readonly cron: {
    readonly enabled: boolean;
    readonly max_concurrent_runs: number | null;
  };
  readonly hooks: import("../../hooks.js").HooksConfig;
};

export type GatewayAdminRpcContext = {
  listAdminModels(): { models: readonly unknown[] };
  createAdminModel(input: Record<string, unknown>): { ok: true; model: unknown };
  updateAdminModel(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; model: unknown };
  deleteAdminModel(id: string): boolean;
  listAdminPrompts(): { prompts: readonly unknown[] };
  createAdminPrompt(input: Record<string, unknown>): { ok: true; prompt: unknown };
  updateAdminPrompt(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; prompt: unknown };
  deleteAdminPrompt(id: string): boolean;
  listMcpServers(userId: string): Promise<{ servers: readonly unknown[] }>;
  createMcpServer(userId: string, input: Record<string, unknown>): Promise<{ ok: true; name: string }>;
  deleteMcpServer(userId: string, name: string): Promise<boolean>;
  listAdminProviders(params?: {
    refresh?: boolean;
  }): Promise<unknown>;
  reloadAdminProviders(): Promise<unknown>;
  getAdminCapabilities(): unknown;
};

export type GatewayRpcMethodDispatchResult =
  | { handled: false }
  | { handled: true; result: unknown }
  | { handled: true; error: string };

