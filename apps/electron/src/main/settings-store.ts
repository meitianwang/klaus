import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import type { ModelRecord, PromptRecord, CronTask, CronChannelBinding, CronRun, CronRunFilters, CronRunTrigger, CronRunStatus, ArtifactOp, ArtifactRecord } from '../shared/types.js'

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
        timezone          TEXT,
        deliver           TEXT,
        webhook_url       TEXT,
        webhook_token     TEXT,
        failure_alert     TEXT,
        channel_binding   TEXT,
        created_by        TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cron_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      TEXT NOT NULL,
        task_name    TEXT NOT NULL,
        session_id   TEXT NOT NULL DEFAULT '',
        started_at   INTEGER NOT NULL,
        finished_at  INTEGER,
        duration_ms  INTEGER,
        trigger_type TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'running',
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_runs_task ON cron_runs(task_id);
      CREATE TABLE IF NOT EXISTS session_artifacts (
        session_id        TEXT NOT NULL,
        file_path         TEXT NOT NULL,
        last_op           TEXT NOT NULL,
        first_seen_at     INTEGER NOT NULL,
        last_modified_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, file_path)
      );
      CREATE INDEX IF NOT EXISTS idx_session_artifacts_session
        ON session_artifacts (session_id, last_modified_at DESC);
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
    if (!cronCols.has('timezone')) {
      this.db.exec(`ALTER TABLE cron_tasks ADD COLUMN timezone TEXT;`)
    }
    if (!cronCols.has('channel_binding')) {
      this.db.exec(`ALTER TABLE cron_tasks ADD COLUMN channel_binding TEXT;`)
    }
    if (!cronCols.has('created_by')) {
      this.db.exec(`ALTER TABLE cron_tasks ADD COLUMN created_by TEXT;`)
    }

    const cronRunCols = cols('cron_runs')
    if (!cronRunCols.has('session_id')) {
      // Dev stage: wipe old cron_runs on first migration so every row has a
      // real per-run sessionId the sidebar can open. Old rows shared
      // `cron-<taskId>` and don't fit the new per-run model.
      this.db.exec(`DELETE FROM cron_runs;`)
      this.db.exec(`ALTER TABLE cron_runs ADD COLUMN session_id TEXT NOT NULL DEFAULT '';`)
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

  /**
   * Replace the entire prompts cache with the given records in one transaction.
   * Used by engine-host to mirror the cloud's prompts into the local offline
   * cache after each successful fetch.
   */
  replaceAllPrompts(records: Array<{ id: string; name: string; content: string; isDefault?: boolean; createdAt?: number; updatedAt?: number }>): void {
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM prompts').run()
      const insert = this.db.prepare(`
        INSERT INTO prompts (id, name, content, is_default, created_at, updated_at)
        VALUES (@id, @name, @content, @isDefault, @createdAt, @updatedAt)
      `)
      for (const r of records) {
        insert.run({
          id: r.id,
          name: r.name,
          content: r.content,
          isDefault: r.isDefault ? 1 : 0,
          createdAt: r.createdAt ?? now,
          updatedAt: r.updatedAt ?? now,
        })
      }
    })()
  }

  setDefaultPrompt(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE prompts SET is_default = 0').run()
      this.db.prepare('UPDATE prompts SET is_default = 1 WHERE id = ?').run(id)
    })()
  }

  // --- Session artifacts (files agent wrote/edited during a session) ---

  upsertArtifact(sessionId: string, filePath: string, op: ArtifactOp): ArtifactRecord {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO session_artifacts (session_id, file_path, last_op, first_seen_at, last_modified_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, file_path) DO UPDATE SET
        last_op = excluded.last_op,
        last_modified_at = excluded.last_modified_at
    `).run(sessionId, filePath, op, now, now)
    return this.getArtifact(sessionId, filePath)!
  }

  getArtifact(sessionId: string, filePath: string): ArtifactRecord | undefined {
    const row = this.db.prepare(
      'SELECT session_id, file_path, last_op, first_seen_at, last_modified_at FROM session_artifacts WHERE session_id = ? AND file_path = ?'
    ).get(sessionId, filePath) as any
    return row ? rowToArtifact(row) : undefined
  }

  listArtifacts(sessionId: string): ArtifactRecord[] {
    return (this.db.prepare(
      'SELECT session_id, file_path, last_op, first_seen_at, last_modified_at FROM session_artifacts WHERE session_id = ? ORDER BY last_modified_at DESC'
    ).all(sessionId) as any[]).map(rowToArtifact)
  }

  deleteArtifactsBySession(sessionId: string): number {
    return this.db.prepare('DELETE FROM session_artifacts WHERE session_id = ?').run(sessionId).changes
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
    // channel_binding is upsert-only on *create* — editing a task never rewrites
    // it (UI enforces read-only; the IM-inbound path creates a new task). So
    // keep the existing column value on UPDATE by intentionally omitting it
    // from the SET clause. Same goes for created_by.
    const existing = this.getTask(task.id)
    const bindingJson = task.channelBinding
      ? JSON.stringify(task.channelBinding)
      : (existing?.channelBinding ? JSON.stringify(existing.channelBinding) : null)
    const createdBy = task.createdBy ?? existing?.createdBy ?? 'manual'
    this.db.prepare(`
      INSERT INTO cron_tasks (
        id, user_id, name, description, schedule, prompt, enabled, thinking,
        timeout_seconds, delete_after_run, timezone,
        channel_binding, created_by, created_at, updated_at
      ) VALUES (
        @id, @userId, @name, @description, @schedule, @prompt, @enabled, @thinking,
        @timeoutSeconds, @deleteAfterRun, @timezone,
        @channelBinding, @createdBy, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, schedule=excluded.schedule,
        prompt=excluded.prompt, enabled=excluded.enabled, thinking=excluded.thinking,
        timeout_seconds=excluded.timeout_seconds,
        delete_after_run=excluded.delete_after_run,
        timezone=excluded.timezone,
        updated_at=excluded.updated_at
    `).run({
      id: task.id, userId: (task as any).userId ?? null,
      name: task.name ?? null, description: task.description ?? null,
      schedule: task.schedule, prompt: task.prompt,
      enabled: task.enabled ? 1 : 0, thinking: task.thinking ?? null,
      timeoutSeconds: task.timeoutSeconds ?? null,
      deleteAfterRun: task.deleteAfterRun ? 1 : 0,
      timezone: task.timezone ?? null,
      channelBinding: bindingJson,
      createdBy,
      createdAt: task.createdAt || now, updatedAt: now,
    })
  }

  /** Engine bridge — list all tasks for a given userId scope. Desktop falls back to all tasks when userId is absent. */
  listUserTasks(userId: string | null | undefined): CronTask[] {
    if (!userId) return this.listTasks()
    return (this.db.prepare(
      'SELECT * FROM cron_tasks WHERE user_id = ? ORDER BY created_at ASC'
    ).all(userId) as any[]).map(rowToCronTask)
  }

  /** Engine bridge — delete a single task within a userId scope. Desktop ignores the scope. */
  deleteUserTask(_userId: string, id: string): boolean {
    return this.deleteTask(id)
  }

  deleteTask(id: string): boolean {
    return this.db.prepare('DELETE FROM cron_tasks WHERE id = ?').run(id).changes > 0
  }

  /**
   * User-initiated delete: cascade the task, all its run rows, and hand back
   * every run's sessionId so the caller can clean JSONL + registry entries.
   * Atomic — both table writes run in one txn. Returns empty sessionIds list
   * when the task id doesn't exist (caller can treat as no-op).
   */
  deleteTaskCascade(id: string): { deleted: boolean; sessionIds: string[] } {
    const txn = this.db.transaction((taskId: string) => {
      // Single quotes: SQLite treats "" as an identifier, not a string literal.
      const rows = this.db.prepare(
        "SELECT session_id FROM cron_runs WHERE task_id = ? AND session_id != ''"
      ).all(taskId) as Array<{ session_id: string }>
      const sessionIds = rows.map(r => r.session_id).filter(Boolean)
      this.db.prepare('DELETE FROM cron_runs WHERE task_id = ?').run(taskId)
      const info = this.db.prepare('DELETE FROM cron_tasks WHERE id = ?').run(taskId)
      return { deleted: info.changes > 0, sessionIds }
    })
    return txn(id)
  }

  // --- Cron runs (execution history) ---

  createCronRun(taskId: string, taskName: string, triggerType: CronRunTrigger): { id: number; sessionId: string } {
    const now = Date.now()
    // Per-run sessionId so the sidebar "定时任务" group can open each execution
    // as its own chat. Prefix keeps them filterable out of the flat list.
    const sessionId = `cron-run-${taskId}-${now}-${Math.random().toString(36).slice(2, 8)}`
    const info = this.db.prepare(
      'INSERT INTO cron_runs (task_id, task_name, session_id, started_at, trigger_type, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(taskId, taskName, sessionId, now, triggerType, 'running')
    return { id: Number(info.lastInsertRowid), sessionId }
  }

  finishCronRun(id: number, status: Exclude<CronRunStatus, 'running'>, durationMs: number, error?: string | null): void {
    this.db.prepare(
      'UPDATE cron_runs SET finished_at = ?, duration_ms = ?, status = ?, error = ? WHERE id = ?'
    ).run(Date.now(), durationMs, status, error ?? null, id)
  }

  listCronRuns(filters: CronRunFilters = {}): CronRun[] {
    const where: string[] = []
    const args: any[] = []
    if (filters.taskId) { where.push('task_id = ?'); args.push(filters.taskId) }
    if (filters.status) { where.push('status = ?'); args.push(filters.status) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000)
    const offset = Math.max(filters.offset ?? 0, 0)
    const rows = this.db.prepare(
      `SELECT * FROM cron_runs${whereSql} ORDER BY started_at DESC LIMIT ? OFFSET ?`
    ).all(...args, limit, offset) as any[]
    return rows.map(rowToCronRun)
  }

  /**
   * Reap stale running rows on startup — if the app crashed mid-execution,
   * those rows would otherwise stay 'running' forever. Anything older than
   * 24 h still in 'running' is marked failed with a crash note.
   */
  reapStaleCronRuns(): number {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const info = this.db.prepare(
      `UPDATE cron_runs SET status = 'failed', finished_at = started_at,
       duration_ms = 0, error = 'interrupted (app restart)'
       WHERE status = 'running' AND started_at < ?`
    ).run(cutoff)
    return info.changes
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

function rowToArtifact(r: any): ArtifactRecord {
  return {
    sessionId: r.session_id,
    filePath: r.file_path,
    lastOp: r.last_op as ArtifactOp,
    firstSeenAt: r.first_seen_at,
    lastModifiedAt: r.last_modified_at,
  }
}

function rowToCronTask(r: any): CronTask {
  let channelBinding: CronChannelBinding | undefined
  if (r.channel_binding) {
    try {
      const parsed = JSON.parse(r.channel_binding)
      if (parsed && typeof parsed === 'object' && parsed.channelId && parsed.targetId) {
        channelBinding = parsed
      }
    } catch {}
  }
  return {
    id: r.id, name: r.name ?? undefined, description: r.description ?? undefined,
    schedule: r.schedule, prompt: r.prompt,
    enabled: r.enabled === 1, thinking: r.thinking ?? undefined,
    timeoutSeconds: r.timeout_seconds ?? undefined,
    deleteAfterRun: r.delete_after_run === 1,
    timezone: r.timezone ?? undefined,
    channelBinding,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function rowToCronRun(r: any): CronRun {
  return {
    id: r.id,
    taskId: r.task_id,
    taskName: r.task_name,
    sessionId: r.session_id ?? '',
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    durationMs: r.duration_ms ?? null,
    triggerType: r.trigger_type,
    status: r.status,
    error: r.error ?? null,
  }
}
