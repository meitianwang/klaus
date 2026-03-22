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
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        provider            TEXT NOT NULL DEFAULT 'anthropic',
        model               TEXT NOT NULL,
        api_key             TEXT,
        base_url            TEXT,
        max_context_tokens  INTEGER NOT NULL DEFAULT 200000,
        thinking            TEXT NOT NULL DEFAULT 'off',
        is_default          INTEGER NOT NULL DEFAULT 0,
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

  getBool(key: string, fallback: boolean): boolean {
    const raw = this.get(key);
    if (raw == null) return fallback;
    return raw === "true" || raw === "1";
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
        `INSERT INTO models (id, name, provider, model, api_key, base_url, max_context_tokens, thinking, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, provider = excluded.provider, model = excluded.model,
           api_key = excluded.api_key, base_url = excluded.base_url,
           max_context_tokens = excluded.max_context_tokens, thinking = excluded.thinking,
           is_default = excluded.is_default, updated_at = excluded.updated_at`,
      )
      .run(
        m.id, m.name, m.provider, m.model,
        m.apiKey ?? null, m.baseUrl ?? null,
        m.maxContextTokens, m.thinking,
        m.isDefault ? 1 : 0,
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
  created_at: number;
  updated_at: number;
}

function toModelRecord(r: RawModelRow): ModelRecord {
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
