/**
 * Runtime settings store — Postgres-backed configuration for models, prompts, and general settings.
 *
 * All methods are async (delegating to PG repos). Callers must add `await`.
 */

import type { Db } from "./db/connection.js";
import { getDb } from "./db/connection.js";
import type { CronTask } from "./types.js";
import { ModelsRepoPg, type ModelRow } from "./db/repos/models.pg.js";
import { CronRepoPg, type CronTaskRow } from "./db/repos/cron.pg.js";
import { ArtifactsRepoPg, type ArtifactRow } from "./db/repos/artifacts.pg.js";
import { PromptsRepoPg, type PromptRow } from "./db/repos/prompts.pg.js";
import { UserPromptsRepoPg } from "./db/repos/user-prompts.pg.js";
import { UserSettingsRepoPg } from "./db/repos/user-settings.pg.js";
import { SessionsRepoPg } from "./db/repos/sessions.pg.js";
import { CronRunsRepoPg } from "./db/repos/cron-runs.pg.js";
import { TokenUsageRepoPg } from "./db/repos/token-usage.pg.js";
import { PlatformSettingsRepoPg } from "./db/repos/platform-settings.pg.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelCostRecord {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** Valid model roles matching CC engine tiers. */
export type ModelRole = "sonnet" | "haiku" | "opus";

export interface ModelRecord {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly maxContextTokens: number;
  readonly thinking: string;
  readonly isDefault: boolean;
  readonly role?: ModelRole;
  readonly cost?: ModelCostRecord;
  readonly authType?: "api_key" | "oauth";
  readonly refreshToken?: string;
  readonly tokenExpiresAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PromptRecord {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isDefault: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ArtifactOp = "write" | "edit" | "notebook_edit";

export interface ArtifactRecord {
  readonly sessionKey: string;
  readonly filePath: string;
  readonly lastOp: ArtifactOp;
  readonly firstSeenAt: number;
  readonly lastModifiedAt: number;
}


// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private readonly models: ModelsRepoPg;
  private readonly cron: CronRepoPg;
  private readonly artifacts: ArtifactsRepoPg;
  private readonly prompts: PromptsRepoPg;
  private readonly platformSettings: PlatformSettingsRepoPg;
  // Phase 0 additions — exposed via accessor methods for future code to use.
  readonly userPrompts: UserPromptsRepoPg;
  readonly userSettings: UserSettingsRepoPg;
  readonly sessions: SessionsRepoPg;
  readonly cronRuns: CronRunsRepoPg;
  readonly tokenUsage: TokenUsageRepoPg;

  constructor(db?: Db | string) {
    // Accept legacy (dbPath?: string) signature — if string, ignore it (PG uses DATABASE_URL).
    const resolvedDb = (db == null || typeof db === "string") ? getDb() : db;
    this.models = new ModelsRepoPg(resolvedDb);
    this.cron = new CronRepoPg(resolvedDb);
    this.artifacts = new ArtifactsRepoPg(resolvedDb);
    this.prompts = new PromptsRepoPg(resolvedDb);
    this.platformSettings = new PlatformSettingsRepoPg(resolvedDb);
    this.userPrompts = new UserPromptsRepoPg(resolvedDb);
    this.userSettings = new UserSettingsRepoPg(resolvedDb);
    this.sessions = new SessionsRepoPg(resolvedDb);
    this.cronRuns = new CronRunsRepoPg(resolvedDb);
    this.tokenUsage = new TokenUsageRepoPg(resolvedDb);
  }

  /**
   * Apply model role settings to process.env so the CC engine's
   * getDefaultSonnetModel() / getDefaultHaikuModel() / getSmallFastModel()
   * return the correct model IDs for this Klaus instance.
   *
   * Call once at startup after SettingsStore is initialized.
   */
  async applyModelEnvOverrides(): Promise<void> {
    const sonnetModel = await this.getModelByRole("sonnet");
    const haikuModel = await this.getModelByRole("haiku");
    const opusModel = await this.getModelByRole("opus");

    if (sonnetModel) {
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel.model;
    }
    if (haikuModel) {
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel.model;
      process.env.ANTHROPIC_SMALL_FAST_MODEL = haikuModel.model;
    }
    if (opusModel) {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel.model;
    }

    // Fall back to the default model for any unconfigured tier.
    const defaultModel = await this.getDefaultModel();
    if (defaultModel) {
      if (!sonnetModel) {
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = defaultModel.model;
      }
      if (!haikuModel) {
        process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = defaultModel.model;
        process.env.ANTHROPIC_SMALL_FAST_MODEL = defaultModel.model;
      }
      if (!opusModel) {
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = defaultModel.model;
      }
    }
  }

  // -----------------------------------------------------------------------
  // KV settings (platform-global)
  // -----------------------------------------------------------------------

  async get(key: string): Promise<string | undefined> {
    return this.platformSettings.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    return this.platformSettings.set(key, value);
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async getHooks(): Promise<import("./hooks.js").HooksConfig> {
    const raw = await this.get("hooks");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as import("./hooks.js").HooksConfig;
    } catch {
      return {};
    }
  }

  async setHooks(config: import("./hooks.js").HooksConfig): Promise<void> {
    await this.set("hooks", JSON.stringify(config));
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.get(key);
    if (raw == null) return fallback;
    return raw === "true" || raw === "1";
  }

  /** Bulk-read all settings whose key starts with the given prefix. */
  async getByPrefix(prefix: string): Promise<Map<string, string>> {
    return this.platformSettings.getByPrefix(prefix);
  }

  /** Bulk-load all admin skill settings (enabled state + encrypted API keys). */
  async getSkillSettings(): Promise<Map<string, { enabled: boolean | undefined; encryptedApiKey: string | undefined }>> {
    const raw = await this.getByPrefix("skill.");
    const result = new Map<string, { enabled: boolean | undefined; encryptedApiKey: string | undefined }>();
    for (const [key, value] of raw) {
      const match = key.match(/^skill\.(.+)\.(enabled|apiKey)$/);
      if (!match) continue;
      const [, skillName, field] = match;
      if (!result.has(skillName)) result.set(skillName, { enabled: undefined, encryptedApiKey: undefined });
      const entry = result.get(skillName)!;
      if (field === "enabled") {
        entry.enabled = value === "true" ? true : value === "false" ? false : undefined;
      } else if (field === "apiKey") {
        entry.encryptedApiKey = value || undefined;
      }
    }
    return result;
  }

  /** Bulk-load per-user skill preferences (single SQL query). */
  async getUserSkillPreferences(userId: string): Promise<Map<string, "on" | "off">> {
    const prefix = `user.${userId}.skill.`;
    const raw = await this.getByPrefix(prefix);
    const result = new Map<string, "on" | "off">();
    for (const [key, value] of raw) {
      const skillName = key.slice(prefix.length);
      if (value === "on" || value === "off") result.set(skillName, value);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Per-user settings (language, output_style)
  // -----------------------------------------------------------------------

  async getUserLanguage(userId: string): Promise<string | undefined> {
    return (await this.get(`user.${userId}.language`)) || undefined;
  }

  async setUserLanguage(userId: string, language: string): Promise<void> {
    await this.set(`user.${userId}.language`, language);
  }

  async getUserOutputStyle(userId: string): Promise<string | undefined> {
    return (await this.get(`user.${userId}.output_style`)) || undefined;
  }

  async setUserOutputStyle(userId: string, style: string): Promise<void> {
    await this.set(`user.${userId}.output_style`, style);
  }

  async getUserPermissionMode(userId: string): Promise<string | undefined> {
    return (await this.get(`user.${userId}.permission_mode`)) || undefined;
  }

  async setUserPermissionMode(userId: string, mode: string): Promise<void> {
    await this.set(`user.${userId}.permission_mode`, mode);
  }

  // -----------------------------------------------------------------------
  // Models CRUD
  // -----------------------------------------------------------------------

  async listModels(): Promise<ModelRecord[]> {
    return (await this.models.list()).map(toModelRecord);
  }

  async getModel(id: string): Promise<ModelRecord | undefined> {
    const row = await this.models.findById(id);
    return row ? toModelRecord(row) : undefined;
  }

  async getDefaultModel(): Promise<ModelRecord | undefined> {
    const row = (await this.models.findDefault()) ?? (await this.models.findFirst());
    return row ? toModelRecord(row) : undefined;
  }

  async upsertModel(m: ModelRecord): Promise<void> {
    const now = Date.now();
    await this.models.upsert({
      id: m.id,
      name: m.name,
      provider: m.provider,
      model: m.model,
      apiKey: m.apiKey ?? null,
      baseUrl: m.baseUrl ?? null,
      maxContextTokens: m.maxContextTokens,
      thinking: m.thinking,
      isDefault: m.isDefault ? 1 : 0,
      role: m.role ?? null,
      costInput: m.cost?.input ?? null,
      costOutput: m.cost?.output ?? null,
      costCacheRead: m.cost?.cacheRead ?? null,
      costCacheWrite: m.cost?.cacheWrite ?? null,
      authType: m.authType ?? "api_key",
      refreshToken: m.refreshToken ?? null,
      tokenExpiresAt: m.tokenExpiresAt ?? null,
      createdAt: m.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteModel(id: string): Promise<boolean> {
    return this.models.delete(id);
  }

  async setDefaultModel(id: string): Promise<void> {
    return this.models.setDefault(id);
  }

  /** Assign a role to a model. Clears the role from any other model first. */
  async setModelRole(id: string, role: ModelRole | null): Promise<void> {
    return this.models.setRole(id, role);
  }

  /** Get the model assigned to a specific role, or undefined. */
  async getModelByRole(role: ModelRole): Promise<ModelRecord | undefined> {
    const row = await this.models.findByRole(role);
    return row ? toModelRecord(row) : undefined;
  }

  // -----------------------------------------------------------------------
  // Prompts CRUD
  // -----------------------------------------------------------------------

  async listPrompts(): Promise<PromptRecord[]> {
    return (await this.prompts.list()).map(toPromptRecord);
  }

  async getPrompt(id: string): Promise<PromptRecord | undefined> {
    const row = await this.prompts.findById(id);
    return row ? toPromptRecord(row) : undefined;
  }

  async getDefaultPrompt(): Promise<PromptRecord | undefined> {
    const row = (await this.prompts.findDefault()) ?? (await this.prompts.findFirst());
    return row ? toPromptRecord(row) : undefined;
  }

  async upsertPrompt(p: PromptRecord): Promise<void> {
    const now = Date.now();
    await this.prompts.upsert({
      id: p.id,
      name: p.name,
      content: p.content,
      isDefault: p.isDefault ? 1 : 0,
      createdAt: p.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deletePrompt(id: string): Promise<boolean> {
    return this.prompts.delete(id);
  }

  async setDefaultPrompt(id: string): Promise<void> {
    return this.prompts.setDefault(id);
  }

  // -----------------------------------------------------------------------
  // Session artifacts (files written/edited by agent during a session)
  // -----------------------------------------------------------------------

  /**
   * Phase 0: prefer `upsertArtifactForUser` (records user_id for RLS-friendly queries).
   * The non-user `upsertArtifact` overload throws on PG (NOT NULL user_id constraint).
   */
  async upsertArtifact(_sessionKey: string, _filePath: string, _op: ArtifactOp): Promise<ArtifactRecord> {
    throw new Error("[SettingsStore.upsertArtifact] PG requires user_id; call upsertArtifactForUser instead");
  }

  async upsertArtifactForUser(
    sessionKey: string,
    userId: string,
    filePath: string,
    op: ArtifactOp,
  ): Promise<ArtifactRecord> {
    const now = Date.now();
    await this.artifacts.upsertWithUser(sessionKey, userId, filePath, op, now);
    return (await this.getArtifact(sessionKey, filePath))!;
  }

  async getArtifact(sessionKey: string, filePath: string): Promise<ArtifactRecord | undefined> {
    const row = await this.artifacts.findBySessionAndPath(sessionKey, filePath);
    return row ? toArtifactRecord(row) : undefined;
  }

  async listArtifacts(sessionKey: string): Promise<ArtifactRecord[]> {
    return (await this.artifacts.listBySession(sessionKey)).map(toArtifactRecord);
  }

  /** Cascade-delete all artifact rows for a session. Returns the row count. */
  async deleteArtifactsBySession(sessionKey: string): Promise<number> {
    return this.artifacts.deleteBySession(sessionKey);
  }

  // -----------------------------------------------------------------------
  // Cron tasks CRUD
  // -----------------------------------------------------------------------

  async listTasks(): Promise<CronTask[]> {
    return (await this.cron.list()).map(toCronTask);
  }

  async getTask(id: string): Promise<CronTask | undefined> {
    const row = await this.cron.findById(id);
    return row ? toCronTask(row) : undefined;
  }

  async upsertTask(task: CronTask): Promise<void> {
    const now = Date.now();
    await this.cron.upsert({
      id: task.id,
      userId: task.userId ?? null,
      name: task.name ?? null,
      description: task.description ?? null,
      schedule:
        typeof task.schedule === "string"
          ? task.schedule
          : JSON.stringify(task.schedule),
      prompt: task.prompt,
      enabled: task.enabled !== false ? 1 : 0,
      thinking: task.thinking ?? null,
      lightContext: task.lightContext ? 1 : 0,
      timeoutSeconds: task.timeoutSeconds ?? null,
      deleteAfterRun: task.deleteAfterRun ? 1 : 0,
      deliver: task.deliver ? JSON.stringify(task.deliver) : null,
      webhookUrl: task.webhookUrl ?? null,
      webhookToken: task.webhookToken ?? null,
      failureAlert: task.failureAlert != null ? JSON.stringify(task.failureAlert) : null,
      createdAt: task.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.cron.delete(id);
  }

  async listUserTasks(userId: string): Promise<CronTask[]> {
    return (await this.cron.listByUser(userId)).map(toCronTask);
  }

  async deleteUserTask(userId: string, taskId: string): Promise<boolean> {
    return this.cron.deleteUserTask(userId, taskId);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** No-op — PG pool is managed globally. */
  close(): void {
    // PG pool lifecycle is managed by getDb() singleton; nothing to close here.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse JSON; on failure return undefined and log so corrupt rows surface in ops. */
function safeJsonParse(raw: string, context?: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[SettingsStore] JSON parse failed${context ? ` (${context})` : ""}:`,
      err,
      "raw:",
      raw.slice(0, 200),
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Raw row types + converters
// ---------------------------------------------------------------------------

function toModelRecord(r: ModelRow): ModelRecord {
  const cost: ModelCostRecord | undefined =
    r.cost_input != null && r.cost_output != null
      ? {
          input: r.cost_input,
          output: r.cost_output,
          ...(r.cost_cache_read != null ? { cacheRead: r.cost_cache_read } : {}),
          ...(r.cost_cache_write != null ? { cacheWrite: r.cost_cache_write } : {}),
        }
      : undefined;
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    ...(r.api_key ? { apiKey: r.api_key } : {}),
    ...(r.base_url ? { baseUrl: r.base_url } : {}),
    maxContextTokens: r.max_context_tokens,
    thinking: r.thinking,
    isDefault: r.is_default === 1,
    ...(cost ? { cost } : {}),
    ...(r.role ? { role: r.role as ModelRole } : {}),
    authType: (r.auth_type as "api_key" | "oauth") ?? "api_key",
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}),
    ...(r.token_expires_at != null ? { tokenExpiresAt: r.token_expires_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toPromptRecord(r: PromptRow): PromptRecord {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toArtifactRecord(r: ArtifactRow): ArtifactRecord {
  return {
    sessionKey: r.session_key,
    filePath: r.file_path,
    lastOp: r.last_op as ArtifactOp,
    firstSeenAt: r.first_seen_at,
    lastModifiedAt: r.last_modified_at,
  };
}

function toCronTask(r: CronTaskRow): CronTask {
  return {
    id: r.id,
    ...(r.user_id ? { userId: r.user_id } : {}),
    ...(r.name ? { name: r.name } : {}),
    ...(r.description ? { description: r.description } : {}),
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled === 1,
    ...(r.thinking ? { thinking: r.thinking as CronTask["thinking"] } : {}),
    ...(r.light_context ? { lightContext: true } : {}),
    ...(r.timeout_seconds != null ? { timeoutSeconds: r.timeout_seconds } : {}),
    ...(r.delete_after_run ? { deleteAfterRun: true } : {}),
    // Defensive: if a row has corrupt JSON we drop the field rather than
    // shipping `undefined` typed as the real shape (which would crash callers).
    ...(r.deliver
      ? (() => {
          const parsed = safeJsonParse(r.deliver, `cron_tasks.deliver id=${r.id}`);
          return parsed !== undefined ? { deliver: parsed as CronTask["deliver"] } : {};
        })()
      : {}),
    ...(r.webhook_url ? { webhookUrl: r.webhook_url } : {}),
    ...(r.webhook_token ? { webhookToken: r.webhook_token } : {}),
    ...(r.failure_alert
      ? (() => {
          const parsed = safeJsonParse(r.failure_alert, `cron_tasks.failure_alert id=${r.id}`);
          return parsed !== undefined ? { failureAlert: parsed as CronTask["failureAlert"] } : {};
        })()
      : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
