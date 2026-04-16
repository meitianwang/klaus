import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import type { ModelRecord, PromptRecord, CronTask } from '../shared/types.js'

const CONFIG_DIR = join(homedir(), '.klaus')

export class SettingsStore {
  private db: Database.Database

  constructor(dbPath?: string) {
    const path = dbPath ?? join(CONFIG_DIR, 'settings.db')
    mkdirSync(CONFIG_DIR, { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.createTables()
    this.migrate()
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
        auth_type           TEXT DEFAULT 'api_key',
        refresh_token       TEXT,
        token_expires_at    INTEGER,
        role                TEXT,
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
        user_id           TEXT,
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
    `)
  }

  private migrate(): void {
    const cols = (table: string) => {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      return new Set(rows.map(r => r.name))
    }

    const modelCols = cols('models')
    if (!modelCols.has('cost_input')) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN cost_input REAL;
        ALTER TABLE models ADD COLUMN cost_output REAL;
        ALTER TABLE models ADD COLUMN cost_cache_read REAL;
        ALTER TABLE models ADD COLUMN cost_cache_write REAL;
      `)
    }
    if (!modelCols.has('auth_type')) {
      this.db.exec(`
        ALTER TABLE models ADD COLUMN auth_type TEXT DEFAULT 'api_key';
        ALTER TABLE models ADD COLUMN refresh_token TEXT;
        ALTER TABLE models ADD COLUMN token_expires_at INTEGER;
      `)
    }
    if (!modelCols.has('role')) {
      this.db.exec(`ALTER TABLE models ADD COLUMN role TEXT;`)
    }

    const cronCols = cols('cron_tasks')
    if (!cronCols.has('user_id')) {
      this.db.exec(`ALTER TABLE cron_tasks ADD COLUMN user_id TEXT;`)
    }
  }

  // --- KV settings ---

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  getNumber(key: string, fallback: number): number {
    const v = this.get(key)
    if (v === undefined) return fallback
    const n = Number(v)
    return Number.isNaN(n) ? fallback : n
  }

  getBool(key: string, fallback: boolean): boolean {
    const v = this.get(key)
    if (v === undefined) return fallback
    return v === '1' || v === 'true'
  }

  getByPrefix(prefix: string): Map<string, string> {
    const escaped = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE key LIKE ? ESCAPE '\\'").all(escaped + '%') as Array<{ key: string; value: string }>
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.key, r.value)
    return map
  }

  getSkillSettings(): Map<string, { enabled?: boolean; encryptedApiKey?: string }> {
    const map = new Map<string, { enabled?: boolean; encryptedApiKey?: string }>()
    for (const [k, v] of this.getByPrefix('skill:')) {
      const skillId = k.slice('skill:'.length)
      try {
        map.set(skillId, JSON.parse(v))
      } catch {
        map.set(skillId, {})
      }
    }
    return map
  }

  // --- Models ---

  listModels(): ModelRecord[] {
    return (this.db.prepare('SELECT * FROM models ORDER BY is_default DESC, name ASC').all() as any[]).map(rowToModel)
  }

  getModel(id: string): ModelRecord | undefined {
    const row = this.db.prepare('SELECT * FROM models WHERE id = ?').get(id) as any
    return row ? rowToModel(row) : undefined
  }

  getDefaultModel(): ModelRecord | undefined {
    const row = this.db.prepare('SELECT * FROM models WHERE is_default = 1 LIMIT 1').get() as any
    if (row) return rowToModel(row)
    const first = this.db.prepare('SELECT * FROM models LIMIT 1').get() as any
    return first ? rowToModel(first) : undefined
  }

  upsertModel(m: ModelRecord): void {
    this.db.prepare(`
      INSERT INTO models (id, name, provider, model, api_key, base_url, max_context_tokens, thinking, is_default,
        cost_input, cost_output, cost_cache_read, cost_cache_write, auth_type, refresh_token, token_expires_at, role, created_at, updated_at)
      VALUES (@id, @name, @provider, @model, @apiKey, @baseUrl, @maxContextTokens, @thinking, @isDefault,
        @costInput, @costOutput, @costCacheRead, @costCacheWrite, @authType, @refreshToken, @tokenExpiresAt, @role, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, provider=excluded.provider, model=excluded.model, api_key=excluded.api_key,
        base_url=excluded.base_url, max_context_tokens=excluded.max_context_tokens, thinking=excluded.thinking,
        is_default=excluded.is_default, cost_input=excluded.cost_input, cost_output=excluded.cost_output,
        cost_cache_read=excluded.cost_cache_read, cost_cache_write=excluded.cost_cache_write,
        auth_type=excluded.auth_type, refresh_token=excluded.refresh_token, token_expires_at=excluded.token_expires_at,
        role=excluded.role, updated_at=excluded.updated_at
    `).run({
      id: m.id, name: m.name, provider: m.provider, model: m.model,
      apiKey: m.apiKey ?? null, baseUrl: m.baseUrl ?? null,
      maxContextTokens: m.maxContextTokens, thinking: m.thinking,
      isDefault: m.isDefault ? 1 : 0,
      costInput: m.costInput ?? null, costOutput: m.costOutput ?? null,
      costCacheRead: m.costCacheRead ?? null, costCacheWrite: m.costCacheWrite ?? null,
      authType: m.authType ?? 'api_key', refreshToken: m.refreshToken ?? null,
      tokenExpiresAt: m.tokenExpiresAt ?? null, role: m.role ?? null,
      createdAt: m.createdAt, updatedAt: m.updatedAt,
    })
  }

  deleteModel(id: string): boolean {
    return this.db.prepare('DELETE FROM models WHERE id = ?').run(id).changes > 0
  }

  setDefaultModel(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE models SET is_default = 0').run()
      this.db.prepare('UPDATE models SET is_default = 1 WHERE id = ?').run(id)
    })()
  }

  setModelRole(id: string, role: string | null): void {
    this.db.transaction(() => {
      if (role) {
        this.db.prepare('UPDATE models SET role = NULL WHERE role = ?').run(role)
      }
      this.db.prepare('UPDATE models SET role = ? WHERE id = ?').run(role, id)
    })()
  }

  getModelByRole(role: string): ModelRecord | undefined {
    const row = this.db.prepare('SELECT * FROM models WHERE role = ? LIMIT 1').get(role) as any
    return row ? rowToModel(row) : undefined
  }

  applyModelEnvOverrides(): void {
    const sonnet = this.getModelByRole('sonnet')
    const haiku = this.getModelByRole('haiku')
    const opus = this.getModelByRole('opus')
    if (sonnet) {
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet.model
    }
    if (haiku) {
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku.model
      process.env.ANTHROPIC_SMALL_FAST_MODEL = haiku.model
    }
    if (opus) {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus.model
    }
  }

  // --- Prompts ---

  listPrompts(): PromptRecord[] {
    return (this.db.prepare('SELECT * FROM prompts ORDER BY is_default DESC, name ASC').all() as any[]).map(rowToPrompt)
  }

  getPrompt(id: string): PromptRecord | undefined {
    const row = this.db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any
    return row ? rowToPrompt(row) : undefined
  }

  upsertPrompt(p: PromptRecord): void {
    this.db.prepare(`
      INSERT INTO prompts (id, name, content, is_default, created_at, updated_at)
      VALUES (@id, @name, @content, @isDefault, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, content=excluded.content, is_default=excluded.is_default, updated_at=excluded.updated_at
    `).run({
      id: p.id, name: p.name, content: p.content,
      isDefault: p.isDefault ? 1 : 0,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    })
  }

  deletePrompt(id: string): boolean {
    return this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id).changes > 0
  }

  setDefaultPrompt(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE prompts SET is_default = 0').run()
      this.db.prepare('UPDATE prompts SET is_default = 1 WHERE id = ?').run(id)
    })()
  }

  // --- Cron Tasks ---

  listTasks(): CronTask[] {
    return (this.db.prepare('SELECT * FROM cron_tasks ORDER BY created_at ASC').all() as any[]).map(rowToCronTask)
  }

  getTask(id: string): CronTask | undefined {
    const row = this.db.prepare('SELECT * FROM cron_tasks WHERE id = ?').get(id) as any
    return row ? rowToCronTask(row) : undefined
  }

  upsertTask(task: CronTask): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO cron_tasks (id, name, description, schedule, prompt, enabled, thinking, timeout_seconds, created_at, updated_at)
      VALUES (@id, @name, @description, @schedule, @prompt, @enabled, @thinking, @timeoutSeconds, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, schedule=excluded.schedule,
        prompt=excluded.prompt, enabled=excluded.enabled, thinking=excluded.thinking,
        timeout_seconds=excluded.timeout_seconds, updated_at=excluded.updated_at
    `).run({
      id: task.id, name: task.name ?? null, description: task.description ?? null,
      schedule: task.schedule, prompt: task.prompt,
      enabled: task.enabled ? 1 : 0, thinking: task.thinking ?? null,
      timeoutSeconds: task.timeoutSeconds ?? null,
      createdAt: task.createdAt || now, updatedAt: now,
    })
  }

  deleteTask(id: string): boolean {
    return this.db.prepare('DELETE FROM cron_tasks WHERE id = ?').run(id).changes > 0
  }

  close(): void {
    this.db.close()
  }
}

// --- Row converters ---

function rowToModel(r: any): ModelRecord {
  return {
    id: r.id, name: r.name, provider: r.provider, model: r.model,
    apiKey: r.api_key ?? undefined, baseUrl: r.base_url ?? undefined,
    maxContextTokens: r.max_context_tokens, thinking: r.thinking,
    isDefault: r.is_default === 1,
    costInput: r.cost_input ?? undefined, costOutput: r.cost_output ?? undefined,
    costCacheRead: r.cost_cache_read ?? undefined, costCacheWrite: r.cost_cache_write ?? undefined,
    authType: r.auth_type ?? undefined, refreshToken: r.refresh_token ?? undefined,
    tokenExpiresAt: r.token_expires_at ?? undefined, role: r.role ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function rowToPrompt(r: any): PromptRecord {
  return {
    id: r.id, name: r.name, content: r.content,
    isDefault: r.is_default === 1,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function rowToCronTask(r: any): CronTask {
  return {
    id: r.id, name: r.name ?? undefined, description: r.description ?? undefined,
    schedule: r.schedule, prompt: r.prompt,
    enabled: r.enabled === 1, thinking: r.thinking ?? undefined,
    timeoutSeconds: r.timeout_seconds ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
