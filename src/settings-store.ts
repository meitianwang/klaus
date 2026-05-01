/**
 * Runtime settings store — SQLite-backed configuration for models, prompts, and general settings.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { CronTask } from "./types.js";
import { ModelsRepo, type ModelRow } from "./db/repos/models.js";
import { CronRepo, type CronTaskRow } from "./db/repos/cron.js";
import { ArtifactsRepo, type ArtifactRow } from "./db/repos/artifacts.js";
import { PromptsRepo, type PromptRow } from "./db/repos/prompts.js";
import { UserPromptsRepo } from "./db/repos/user-prompts.js";
import { UserSettingsRepo } from "./db/repos/user-settings.js";
import { SessionsRepo } from "./db/repos/sessions.js";
import { CronRunsRepo } from "./db/repos/cron-runs.js";
import { TokenUsageRepo } from "./db/repos/token-usage.js";

const DEFAULT_DB_PATH = join(CONFIG_DIR, "settings.db");

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
  private readonly db: Database;
  private readonly models: ModelsRepo;
  private readonly cron: CronRepo;
  private readonly artifacts: ArtifactsRepo;
  private readonly prompts: PromptsRepo;
  // Phase 0 additions — exposed via accessor methods for future code to use.
  // Existing legacy code paths (e.g. getUserLanguage reading from KV settings)
  // are kept intact; new features should use these repos directly.
  readonly userPrompts: UserPromptsRepo;
  readonly userSettings: UserSettingsRepo;
  readonly sessions: SessionsRepo;
  readonly cronRuns: CronRunsRepo;
  readonly tokenUsage: TokenUsageRepo;

  constructor(dbPath?: string) {
    const path = dbPath ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createTables();
    this.migrate();
    // Repos must be constructed AFTER createTables + migrate so prepared
    // statements see the final column list.
    this.models = new ModelsRepo(this.db);
    this.cron = new CronRepo(this.db);
    this.artifacts = new ArtifactsRepo(this.db);
    this.prompts = new PromptsRepo(this.db);
    this.userPrompts = new UserPromptsRepo(this.db);
    this.userSettings = new UserSettingsRepo(this.db);
    this.sessions = new SessionsRepo(this.db);
    this.cronRuns = new CronRunsRepo(this.db);
    this.tokenUsage = new TokenUsageRepo(this.db);
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        provider            TEXT NOT NULL DEFAULT '',
        model               TEXT NOT NULL,
        api_key             TEXT,
        base_url            TEXT,
        max_context_tokens  INTEGER NOT NULL DEFAULT 200000,
        thinking            TEXT NOT NULL DEFAULT 'off',
        is_default          INTEGER NOT NULL DEFAULT 0,
        cost_input          REAL,
        cost_output         REAL,
        cost_cache_read     REAL,
        cost_cache_write    REAL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        content     TEXT NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_artifacts (
        session_key       TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        last_op           TEXT NOT NULL,
        first_seen_at     INTEGER NOT NULL,
        last_modified_at  INTEGER NOT NULL,
        PRIMARY KEY (session_key, file_path)
      );

      CREATE INDEX IF NOT EXISTS idx_session_artifacts_session
        ON session_artifacts (session_key, last_modified_at DESC);

      CREATE TABLE IF NOT EXISTS cron_tasks (
        id                TEXT PRIMARY KEY,
        name              TEXT,
        description       TEXT,
        schedule          TEXT NOT NULL,
        prompt            TEXT NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 1,
        thinking          TEXT,
        light_context     INTEGER DEFAULT 0,
        timeout_seconds   INTEGER,
        delete_after_run  INTEGER DEFAULT 0,
        deliver           TEXT,
        webhook_url       TEXT,
        webhook_token     TEXT,
        failure_alert     TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );

      -- Phase 0: cron run history (per-execution audit trail)
      CREATE TABLE IF NOT EXISTS cron_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      TEXT NOT NULL,
        user_id      TEXT,
        started_at   INTEGER NOT NULL,
        finished_at  INTEGER,
        status       TEXT NOT NULL,
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_runs_task ON cron_runs(task_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_runs_user ON cron_runs(user_id);

      -- Phase 0: per-call token usage (decision #1: platform-shared key + quota)
      CREATE TABLE IF NOT EXISTS token_usage (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT NOT NULL,
        session_id      TEXT,
        model_id        TEXT NOT NULL,
        input_tokens    INTEGER NOT NULL DEFAULT 0,
        output_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_read      INTEGER NOT NULL DEFAULT 0,
        cache_write     INTEGER NOT NULL DEFAULT 0,
        cost_usd        REAL NOT NULL DEFAULT 0,
        occurred_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user_time ON token_usage(user_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model_id, occurred_at);

      -- Phase 0: explicit session index table (Klaus-side metadata only;
      -- transcript content stays in CC engine's local JSONL files per decision #5)
      CREATE TABLE IF NOT EXISTS sessions (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        title            TEXT,
        cwd              TEXT,
        transcript_path  TEXT,
        created_at       INTEGER NOT NULL,
        last_active_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_active_at DESC);

      -- Phase 0: per-user custom prompts (admin-managed prompts stay in the prompts table)
      CREATE TABLE IF NOT EXISTS user_prompts (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        content     TEXT NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_prompts_user ON user_prompts(user_id);

      -- Phase 0: per-user typed key-value preferences (replaces "user.<id>.<key>" in settings KV).
      -- Existing per-user data in the settings KV table stays put for now; new code reads from here.
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id     TEXT NOT NULL,
        key         TEXT NOT NULL,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
  }

  /**
   * Apply model role settings to process.env so the CC engine's
   * getDefaultSonnetModel() / getDefaultHaikuModel() / getSmallFastModel()
   * return the correct model IDs for this Klaus instance.
   *
   * Three tiers matching the CC engine:
   *   model.sonnet  — Sonnet-tier (memory relevance selection via findRelevantMemories)
   *   model.haiku   — Haiku-tier (token counting, hooks, Web Search)
   *   model.opus    — Opus-tier (not currently used by engine internals, reserved)
   *
   * If not set, falls back to the default model to prevent the engine
   * from calling hardcoded Anthropic model IDs on third-party providers.
   * Call once at startup after SettingsStore is initialized.
   */
  applyModelEnvOverrides(): void {
    const sonnetModel = this.getModelByRole("sonnet");
    const haikuModel = this.getModelByRole("haiku");
    const opusModel = this.getModelByRole("opus");

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
    // This prevents the engine from calling hardcoded Anthropic model IDs
    // that don't exist on the user's provider.
    const defaultModel = this.getDefaultModel();
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

  private migrate(): void {
    // Add cost columns to models table (v0.2.2)
    const cols = this.db.prepare("PRAGMA table_info(models)").all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("cost_input")) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN cost_input REAL;
        ALTER TABLE models ADD COLUMN cost_output REAL;
        ALTER TABLE models ADD COLUMN cost_cache_read REAL;
        ALTER TABLE models ADD COLUMN cost_cache_write REAL;
      `);
    }
    // Add user_id column to cron_tasks table (user-level cron)
    const cronCols = this.db.prepare("PRAGMA table_info(cron_tasks)").all() as { name: string }[];
    const cronColNames = new Set(cronCols.map((c) => c.name));
    if (!cronColNames.has("user_id")) {
      this.db.exec(`ALTER TABLE cron_tasks ADD COLUMN user_id TEXT`);
    }
    // Add OAuth columns to models table
    if (!colNames.has("auth_type")) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN auth_type TEXT DEFAULT 'api_key';
        ALTER TABLE models ADD COLUMN refresh_token TEXT;
        ALTER TABLE models ADD COLUMN token_expires_at INTEGER;
      `);
    }
    // Add role column (sonnet / haiku / opus / null)
    if (!colNames.has("role")) {
      this.db.exec(`ALTER TABLE models ADD COLUMN role TEXT`);
    }
    // Phase 0: add user_id to session_artifacts for future RLS-friendly queries.
    // Existing rows get NULL (no owner info available retroactively); new rows
    // are expected to populate user_id via upsertWithUser().
    const artifactCols = this.db
      .prepare("PRAGMA table_info(session_artifacts)")
      .all() as { name: string }[];
    const artifactColNames = new Set(artifactCols.map((c) => c.name));
    if (!artifactColNames.has("user_id")) {
      this.db.exec(`ALTER TABLE session_artifacts ADD COLUMN user_id TEXT`);
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_session_artifacts_user ON session_artifacts(user_id)`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // KV settings
  // -----------------------------------------------------------------------

  get(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  getNumber(key: string, fallback: number): number {
    const raw = this.get(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  getHooks(): import("./hooks.js").HooksConfig {
    const raw = this.get("hooks");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as import("./hooks.js").HooksConfig;
    } catch {
      return {};
    }
  }

  setHooks(config: import("./hooks.js").HooksConfig): void {
    this.set("hooks", JSON.stringify(config));
  }

  getBool(key: string, fallback: boolean): boolean {
    const raw = this.get(key);
    if (raw == null) return fallback;
    return raw === "true" || raw === "1";
  }

  /** Bulk-read all settings whose key starts with the given prefix (single SQL query). */
  getByPrefix(prefix: string): Map<string, string> {
    // Escape SQL LIKE wildcards in the prefix so % and _ are matched literally
    const escaped = prefix.replace(/[%_]/g, (ch) => `\\${ch}`);
    const rows = this.db
      .prepare("SELECT key, value FROM settings WHERE key LIKE ? || '%' ESCAPE '\\'")
      .all(escaped) as { key: string; value: string }[];
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /** Bulk-load all admin skill settings (enabled state + encrypted API keys). */
  getSkillSettings(): Map<string, { enabled: boolean | undefined; encryptedApiKey: string | undefined }> {
    const raw = this.getByPrefix("skill.");
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
  getUserSkillPreferences(userId: string): Map<string, "on" | "off"> {
    const prefix = `user.${userId}.skill.`;
    const raw = this.getByPrefix(prefix);
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

  getUserLanguage(userId: string): string | undefined {
    return this.get(`user.${userId}.language`) || undefined;
  }

  setUserLanguage(userId: string, language: string): void {
    this.set(`user.${userId}.language`, language);
  }

  getUserOutputStyle(userId: string): string | undefined {
    return this.get(`user.${userId}.output_style`) || undefined;
  }

  setUserOutputStyle(userId: string, style: string): void {
    this.set(`user.${userId}.output_style`, style);
  }

  getUserPermissionMode(userId: string): string | undefined {
    return this.get(`user.${userId}.permission_mode`) || undefined;
  }

  setUserPermissionMode(userId: string, mode: string): void {
    this.set(`user.${userId}.permission_mode`, mode);
  }

  // -----------------------------------------------------------------------
  // Models CRUD
  // -----------------------------------------------------------------------

  listModels(): ModelRecord[] {
    return this.models.list().map(toModelRecord);
  }

  getModel(id: string): ModelRecord | undefined {
    const row = this.models.findById(id);
    return row ? toModelRecord(row) : undefined;
  }

  getDefaultModel(): ModelRecord | undefined {
    const row = this.models.findDefault() ?? this.models.findFirst();
    return row ? toModelRecord(row) : undefined;
  }

  upsertModel(m: ModelRecord): void {
    const now = Date.now();
    this.models.upsert({
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

  deleteModel(id: string): boolean {
    return this.models.delete(id);
  }

  setDefaultModel(id: string): void {
    this.models.setDefault(id);
  }

  /** Assign a role to a model. Clears the role from any other model first. */
  setModelRole(id: string, role: ModelRole | null): void {
    this.models.setRole(id, role);
  }

  /** Get the model assigned to a specific role, or undefined. */
  getModelByRole(role: ModelRole): ModelRecord | undefined {
    const row = this.models.findByRole(role);
    return row ? toModelRecord(row) : undefined;
  }

  // -----------------------------------------------------------------------
  // Prompts CRUD
  // -----------------------------------------------------------------------

  listPrompts(): PromptRecord[] {
    return this.prompts.list().map(toPromptRecord);
  }

  getPrompt(id: string): PromptRecord | undefined {
    const row = this.prompts.findById(id);
    return row ? toPromptRecord(row) : undefined;
  }

  getDefaultPrompt(): PromptRecord | undefined {
    const row = this.prompts.findDefault() ?? this.prompts.findFirst();
    return row ? toPromptRecord(row) : undefined;
  }

  upsertPrompt(p: PromptRecord): void {
    const now = Date.now();
    this.prompts.upsert({
      id: p.id,
      name: p.name,
      content: p.content,
      isDefault: p.isDefault ? 1 : 0,
      createdAt: p.createdAt ?? now,
      updatedAt: now,
    });
  }

  deletePrompt(id: string): boolean {
    return this.prompts.delete(id);
  }

  setDefaultPrompt(id: string): void {
    this.prompts.setDefault(id);
  }

  // -----------------------------------------------------------------------
  // Session artifacts (files written/edited by agent during a session)
  // -----------------------------------------------------------------------

  /**
   * Record a file produced by the agent. Idempotent: re-writing the same
   * file just updates last_op + last_modified_at.
   * Returns the resulting record (with first_seen_at preserved on update).
   */
  /**
   * Phase 0: prefer `upsertArtifactForUser` (records user_id for RLS-friendly queries).
   * This overload is kept for legacy callers; new code should pass userId.
   */
  upsertArtifact(sessionKey: string, filePath: string, op: ArtifactOp): ArtifactRecord {
    const now = Date.now();
    this.artifacts.upsert(sessionKey, filePath, op, now);
    return this.getArtifact(sessionKey, filePath)!;
  }

  upsertArtifactForUser(
    sessionKey: string,
    userId: string,
    filePath: string,
    op: ArtifactOp,
  ): ArtifactRecord {
    const now = Date.now();
    this.artifacts.upsertWithUser(sessionKey, userId, filePath, op, now);
    return this.getArtifact(sessionKey, filePath)!;
  }

  getArtifact(sessionKey: string, filePath: string): ArtifactRecord | undefined {
    const row = this.artifacts.findBySessionAndPath(sessionKey, filePath);
    return row ? toArtifactRecord(row) : undefined;
  }

  listArtifacts(sessionKey: string): ArtifactRecord[] {
    return this.artifacts.listBySession(sessionKey).map(toArtifactRecord);
  }

  /** Cascade-delete all artifact rows for a session. Returns the row count. */
  deleteArtifactsBySession(sessionKey: string): number {
    return this.artifacts.deleteBySession(sessionKey);
  }

  // -----------------------------------------------------------------------
  // Cron tasks CRUD
  // -----------------------------------------------------------------------

  listTasks(): CronTask[] {
    return this.cron.list().map(toCronTask);
  }

  getTask(id: string): CronTask | undefined {
    const row = this.cron.findById(id);
    return row ? toCronTask(row) : undefined;
  }

  upsertTask(task: CronTask): void {
    const now = Date.now();
    this.cron.upsert({
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

  deleteTask(id: string): boolean {
    return this.cron.delete(id);
  }

  listUserTasks(userId: string): CronTask[] {
    return this.cron.listByUser(userId).map(toCronTask);
  }

  deleteUserTask(userId: string, taskId: string): boolean {
    return this.cron.deleteUserTask(userId, taskId);
  }

  // MCP config moved to engine's .mcp.json system (engine/services/mcp/config.ts)

  // -----------------------------------------------------------------------
  // Memory config
  // -----------------------------------------------------------------------

  // Old memory config removed — Klaus now uses claude-code engine's three-layer memory system

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  close(): void {
    this.db.close();
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


