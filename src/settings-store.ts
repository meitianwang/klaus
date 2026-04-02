/**
 * Runtime settings store — SQLite-backed configuration for models, prompts, rules, and general settings.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { CronTask } from "./types.js";

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

export interface RuleRecord {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface McpServerRecord {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransportConfig;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type McpTransportConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> };

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private readonly db: DatabaseType;

  constructor(dbPath?: string) {
    const path = dbPath ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.createTables();
    this.migrate();
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

      CREATE TABLE IF NOT EXISTS rules (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        content     TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        transport   TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `);
  }

  private migrate(): void {
    // Add cost columns to models table (v0.2.2)
    const cols = this.db.pragma("table_info(models)") as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("cost_input")) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN cost_input REAL;
        ALTER TABLE models ADD COLUMN cost_output REAL;
        ALTER TABLE models ADD COLUMN cost_cache_read REAL;
        ALTER TABLE models ADD COLUMN cost_cache_write REAL;
      `);
    }
    // Add OAuth columns to models table
    if (!colNames.has("auth_type")) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN auth_type TEXT DEFAULT 'api_key';
        ALTER TABLE models ADD COLUMN refresh_token TEXT;
        ALTER TABLE models ADD COLUMN token_expires_at INTEGER;
      `);
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
  // Models CRUD
  // -----------------------------------------------------------------------

  listModels(): ModelRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM models ORDER BY is_default DESC, name ASC")
      .all() as RawModelRow[];
    return rows.map(toModelRecord);
  }

  getModel(id: string): ModelRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM models WHERE id = ?")
      .get(id) as RawModelRow | undefined;
    return row ? toModelRecord(row) : undefined;
  }

  getDefaultModel(): ModelRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM models WHERE is_default = 1 LIMIT 1")
      .get() as RawModelRow | undefined;
    if (row) return toModelRecord(row);
    // Fallback: first model
    const first = this.db
      .prepare("SELECT * FROM models LIMIT 1")
      .get() as RawModelRow | undefined;
    return first ? toModelRecord(first) : undefined;
  }

  upsertModel(m: ModelRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO models (id, name, provider, model, api_key, base_url, max_context_tokens, thinking, is_default, cost_input, cost_output, cost_cache_read, cost_cache_write, auth_type, refresh_token, token_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, provider = excluded.provider, model = excluded.model,
           api_key = excluded.api_key, base_url = excluded.base_url,
           max_context_tokens = excluded.max_context_tokens, thinking = excluded.thinking,
           is_default = excluded.is_default,
           cost_input = excluded.cost_input, cost_output = excluded.cost_output,
           cost_cache_read = excluded.cost_cache_read, cost_cache_write = excluded.cost_cache_write,
           auth_type = excluded.auth_type, refresh_token = excluded.refresh_token,
           token_expires_at = excluded.token_expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        m.id, m.name, m.provider, m.model,
        m.apiKey ?? null, m.baseUrl ?? null,
        m.maxContextTokens, m.thinking,
        m.isDefault ? 1 : 0,
        m.cost?.input ?? null, m.cost?.output ?? null,
        m.cost?.cacheRead ?? null, m.cost?.cacheWrite ?? null,
        m.authType ?? "api_key", m.refreshToken ?? null, m.tokenExpiresAt ?? null,
        m.createdAt ?? now, now,
      );
  }

  deleteModel(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM models WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  setDefaultModel(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE models SET is_default = 0").run();
      this.db.prepare("UPDATE models SET is_default = 1 WHERE id = ?").run(id);
    })();
  }

  // -----------------------------------------------------------------------
  // Prompts CRUD
  // -----------------------------------------------------------------------

  listPrompts(): PromptRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM prompts ORDER BY is_default DESC, name ASC")
      .all() as RawPromptRow[];
    return rows.map(toPromptRecord);
  }

  getPrompt(id: string): PromptRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM prompts WHERE id = ?")
      .get(id) as RawPromptRow | undefined;
    return row ? toPromptRecord(row) : undefined;
  }

  getDefaultPrompt(): PromptRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM prompts WHERE is_default = 1 LIMIT 1")
      .get() as RawPromptRow | undefined;
    if (row) return toPromptRecord(row);
    const first = this.db
      .prepare("SELECT * FROM prompts LIMIT 1")
      .get() as RawPromptRow | undefined;
    return first ? toPromptRecord(first) : undefined;
  }

  upsertPrompt(p: PromptRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO prompts (id, name, content, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, content = excluded.content,
           is_default = excluded.is_default, updated_at = excluded.updated_at`,
      )
      .run(p.id, p.name, p.content, p.isDefault ? 1 : 0, p.createdAt ?? now, now);
  }

  deletePrompt(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM prompts WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  setDefaultPrompt(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE prompts SET is_default = 0").run();
      this.db.prepare("UPDATE prompts SET is_default = 1 WHERE id = ?").run(id);
    })();
  }

  // -----------------------------------------------------------------------
  // Rules CRUD
  // -----------------------------------------------------------------------

  listRules(): RuleRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM rules ORDER BY sort_order ASC, name ASC")
      .all() as RawRuleRow[];
    return rows.map(toRuleRecord);
  }

  getEnabledRules(): RuleRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM rules WHERE enabled = 1 ORDER BY sort_order ASC, name ASC")
      .all() as RawRuleRow[];
    return rows.map(toRuleRecord);
  }

  upsertRule(r: RuleRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO rules (id, name, content, enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, content = excluded.content,
           enabled = excluded.enabled, sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`,
      )
      .run(r.id, r.name, r.content, r.enabled ? 1 : 0, r.sortOrder, r.createdAt ?? now, now);
  }

  deleteRule(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM rules WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Cron tasks CRUD
  // -----------------------------------------------------------------------

  listTasks(): CronTask[] {
    const rows = this.db
      .prepare("SELECT * FROM cron_tasks ORDER BY created_at ASC")
      .all() as RawCronRow[];
    return rows.map(toCronTask);
  }

  getTask(id: string): CronTask | undefined {
    const row = this.db
      .prepare("SELECT * FROM cron_tasks WHERE id = ?")
      .get(id) as RawCronRow | undefined;
    return row ? toCronTask(row) : undefined;
  }

  upsertTask(task: CronTask): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cron_tasks (id, name, description, schedule, prompt, enabled, thinking, light_context, timeout_seconds, delete_after_run, deliver, webhook_url, webhook_token, failure_alert, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           schedule = excluded.schedule, prompt = excluded.prompt,
           enabled = excluded.enabled, thinking = excluded.thinking,
           light_context = excluded.light_context, timeout_seconds = excluded.timeout_seconds,
           delete_after_run = excluded.delete_after_run, deliver = excluded.deliver,
           webhook_url = excluded.webhook_url, webhook_token = excluded.webhook_token,
           failure_alert = excluded.failure_alert, updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.name ?? null,
        task.description ?? null,
        typeof task.schedule === "string" ? task.schedule : JSON.stringify(task.schedule),
        task.prompt,
        task.enabled !== false ? 1 : 0,
        task.thinking ?? null,
        task.lightContext ? 1 : 0,
        task.timeoutSeconds ?? null,
        task.deleteAfterRun ? 1 : 0,
        task.deliver ? JSON.stringify(task.deliver) : null,
        task.webhookUrl ?? null,
        task.webhookToken ?? null,
        task.failureAlert != null ? JSON.stringify(task.failureAlert) : null,
        task.createdAt ?? now,
        now,
      );
  }

  deleteTask(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM cron_tasks WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // MCP Servers CRUD
  // -----------------------------------------------------------------------

  listMcpServers(): McpServerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name ASC")
      .all() as RawMcpRow[];
    return rows.map(toMcpRecord);
  }

  getEnabledMcpServers(): McpServerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name ASC")
      .all() as RawMcpRow[];
    return rows.map(toMcpRecord);
  }

  getMcpServer(id: string): McpServerRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE id = ?")
      .get(id) as RawMcpRow | undefined;
    return row ? toMcpRecord(row) : undefined;
  }

  upsertMcpServer(s: McpServerRecord): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, name, transport, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, transport = excluded.transport,
           enabled = excluded.enabled, updated_at = excluded.updated_at`,
      )
      .run(s.id, s.name, JSON.stringify(s.transport), s.enabled ? 1 : 0, s.createdAt ?? now, now);
  }

  deleteMcpServer(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM mcp_servers WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // -----------------------------------------------------------------------
  // Memory config
  // -----------------------------------------------------------------------

  getMemoryConfig(): import("./memory/types.js").MemoryConfig {
    type MemorySource = import("./memory/types.js").MemorySource;
    type EmbeddingProviderRequest = import("./memory/types.js").EmbeddingProviderRequest;
    type EmbeddingProviderFallback = import("./memory/types.js").EmbeddingProviderFallback;
    type MemoryCitationsMode = import("./memory/types.js").MemoryCitationsMode;
    type MemoryConfig = import("./memory/types.js").MemoryConfig;

    const enabled = this.getBool("memory.enabled", false);
    const sourcesRaw = this.get("memory.sources");
    let sources: MemorySource[] = ["memory"];
    if (sourcesRaw) {
      try {
        const parsed = JSON.parse(sourcesRaw);
        if (Array.isArray(parsed)) sources = parsed;
      } catch {}
    }

    const provider = (this.get("memory.provider") ?? "auto") as EmbeddingProviderRequest;
    const fallback = (this.get("memory.fallback") ?? "none") as EmbeddingProviderFallback;
    const citations = (this.get("memory.citations") ?? "auto") as MemoryCitationsMode;

    // Per-provider API keys and base URLs.
    // For OpenAI: try dedicated memory key first, then fall back to default model's key.
    const readProviderKey = (id: string): string | undefined => {
      return this.get(`memory.providers.${id}.api_key`) ?? undefined;
    };
    const readProviderUrl = (id: string): string | undefined => {
      return this.get(`memory.providers.${id}.base_url`) ?? undefined;
    };

    let openaiKey = readProviderKey("openai");
    if (!openaiKey) {
      const defaultModel = this.getDefaultModel();
      if (defaultModel?.apiKey && (defaultModel.provider === "openai" || defaultModel.baseUrl?.includes("openai"))) {
        openaiKey = defaultModel.apiKey;
      }
    }

    const providers: MemoryConfig["providers"] = {
      openai: { apiKey: openaiKey, baseUrl: readProviderUrl("openai") },
      gemini: { apiKey: readProviderKey("gemini"), baseUrl: readProviderUrl("gemini") },
      voyage: { apiKey: readProviderKey("voyage"), baseUrl: readProviderUrl("voyage") },
      mistral: { apiKey: readProviderKey("mistral"), baseUrl: readProviderUrl("mistral") },
      ollama: { apiKey: readProviderKey("ollama"), baseUrl: readProviderUrl("ollama") },
    };

    return {
      enabled,
      sources,
      provider,
      fallback,
      model: this.get("memory.model") ?? "",
      citations,
      providers,
      chunking: {
        tokens: this.getNumber("memory.chunk_tokens", 400),
        overlap: this.getNumber("memory.chunk_overlap", 80),
      },
      outputDimensionality: this.getNumber("memory.output_dimensionality", 0) || undefined,
      batch: {
        enabled: this.getBool("memory.batch_enabled", false),
        wait: this.getBool("memory.batch_wait", true),
        concurrency: this.getNumber("memory.batch_concurrency", 2),
        pollIntervalMs: this.getNumber("memory.batch_poll_interval_ms", 10_000),
        timeoutMs: this.getNumber("memory.batch_timeout_ms", 2 * 60_000),
      },
      query: {
        maxResults: this.getNumber("memory.max_results", 6),
        minScore: parseFloat(this.get("memory.min_score") ?? "0.35"),
        hybrid: {
          enabled: this.getBool("memory.hybrid_enabled", true),
          vectorWeight: parseFloat(this.get("memory.hybrid_vector_weight") ?? "0.7"),
          textWeight: parseFloat(this.get("memory.hybrid_text_weight") ?? "0.3"),
        },
        mmr: {
          enabled: this.getBool("memory.mmr_enabled", false),
          lambda: parseFloat(this.get("memory.mmr_lambda") ?? "0.7"),
        },
        temporalDecay: {
          enabled: this.getBool("memory.temporal_decay_enabled", false),
          halfLifeDays: this.getNumber("memory.temporal_decay_half_life_days", 30),
        },
      },
      sync: {
        intervalMinutes: this.getNumber("memory.sync_interval_minutes", 5),
        watch: this.getBool("memory.sync_watch", true),
        watchDebounceMs: this.getNumber("memory.sync_watch_debounce_ms", 1500),
      },
      multimodal: {
        enabled: this.getBool("memory.multimodal_enabled", false),
        modalities: (() => {
          const raw = this.get("memory.multimodal_modalities");
          if (!raw) return ["image" as const, "audio" as const];
          try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
        })(),
        maxFileBytes: this.getNumber("memory.multimodal_max_file_bytes", 10 * 1024 * 1024),
      },
    };
  }

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

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Raw row types + converters
// ---------------------------------------------------------------------------

interface RawModelRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_key: string | null;
  base_url: string | null;
  max_context_tokens: number;
  thinking: string;
  is_default: number;
  cost_input: number | null;
  cost_output: number | null;
  cost_cache_read: number | null;
  cost_cache_write: number | null;
  auth_type: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

function toModelRecord(r: RawModelRow): ModelRecord {
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
    authType: (r.auth_type as "api_key" | "oauth") ?? "api_key",
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : {}),
    ...(r.token_expires_at != null ? { tokenExpiresAt: r.token_expires_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RawPromptRow {
  id: string;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

function toPromptRecord(r: RawPromptRow): PromptRecord {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RawRuleRow {
  id: string;
  name: string;
  content: string;
  enabled: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toRuleRecord(r: RawRuleRow): RuleRecord {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RawCronRow {
  id: string;
  name: string | null;
  description: string | null;
  schedule: string;
  prompt: string;
  enabled: number;
  thinking: string | null;
  light_context: number;
  timeout_seconds: number | null;
  delete_after_run: number;
  deliver: string | null;
  webhook_url: string | null;
  webhook_token: string | null;
  failure_alert: string | null;
  created_at: number;
  updated_at: number;
}

function toCronTask(r: RawCronRow): CronTask {
  return {
    id: r.id,
    ...(r.name ? { name: r.name } : {}),
    ...(r.description ? { description: r.description } : {}),
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled === 1,
    ...(r.thinking ? { thinking: r.thinking as CronTask["thinking"] } : {}),
    ...(r.light_context ? { lightContext: true } : {}),
    ...(r.timeout_seconds != null ? { timeoutSeconds: r.timeout_seconds } : {}),
    ...(r.delete_after_run ? { deleteAfterRun: true } : {}),
    ...(r.deliver ? { deliver: safeJsonParse(r.deliver) as CronTask["deliver"] } : {}),
    ...(r.webhook_url ? { webhookUrl: r.webhook_url } : {}),
    ...(r.webhook_token ? { webhookToken: r.webhook_token } : {}),
    ...(r.failure_alert ? { failureAlert: safeJsonParse(r.failure_alert) as CronTask["failureAlert"] } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RawMcpRow {
  id: string;
  name: string;
  transport: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function toMcpRecord(r: RawMcpRow): McpServerRecord {
  return {
    id: r.id,
    name: r.name,
    transport: safeJsonParse(r.transport) as McpTransportConfig,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
