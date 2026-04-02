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
  listAdminRules(): { rules: readonly unknown[] };
  createAdminRule(input: Record<string, unknown>): { ok: true; rule: unknown };
  updateAdminRule(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; rule: unknown };
  deleteAdminRule(id: string): boolean;
  listAdminMcpServers(): { servers: readonly unknown[] };
  createAdminMcpServer(input: Record<string, unknown>): { ok: true; server: unknown };
  updateAdminMcpServer(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; server: unknown };
  deleteAdminMcpServer(id: string): boolean;
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

