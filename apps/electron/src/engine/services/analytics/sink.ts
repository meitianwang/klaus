/**
 * Analytics sink implementation
 *
 * Klaus-only: routes all events to the local SQLite store.
 * Datadog / 1P event logging have been removed — Klaus doesn't phone home.
 */

import { attachAnalyticsSink } from './index.js'

// Local type matching the logEvent metadata signature
type LogEventMetadata = { [key: string]: boolean | number | undefined }

/**
 * Initialize the analytics sink (no-op — Klaus attaches its own SQLiteAnalyticsSink
 * from src/index.ts). Kept so engine code that calls initializeAnalyticsSink()
 * still compiles.
 */
export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: () => {},
    logEventAsync: () => Promise.resolve(),
  })
}

/** Stub — Datadog gates removed. */
export function initializeAnalyticsGates(): void {}

// ============================================================================
// Klaus-specific: SQLite analytics sink for local event storage
// ============================================================================

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'crypto'

export class SQLiteAnalyticsSink {
  private db: Database
  private insertStmt: ReturnType<Database["prepare"]>

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    `)

    this.insertStmt = this.db.prepare(
      'INSERT INTO events (id, event_name, metadata, created_at) VALUES (?, ?, ?, ?)',
    )
  }

  logEvent(eventName: string, metadata: Record<string, unknown>) {
    try {
      this.insertStmt.run(
        randomUUID(),
        eventName,
        JSON.stringify(metadata),
        new Date().toISOString(),
      )
    } catch {
      // Swallow write errors — analytics must never crash the host
    }
  }

  async logEventAsync(eventName: string, metadata: Record<string, unknown>) {
    this.logEvent(eventName, metadata)
  }

  queryEvents(opts: { eventName?: string; since?: string; limit?: number; offset?: number }) {
    const conditions = []
    const params = []

    if (opts?.eventName) {
      conditions.push('event_name = ?')
      params.push(opts.eventName)
    }
    if (opts?.since) {
      conditions.push('created_at >= ?')
      params.push(opts.since)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0

    const total = (this.db.prepare(`SELECT COUNT(*) as count FROM events ${where}`).get(...params) as any).count

    const events = this.db
      .prepare(
        `SELECT id, event_name, metadata, created_at FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)

    return { events, total }
  }

  getEventCounts(since?: string) {
    const where = since ? 'WHERE created_at >= ?' : ''
    const params = since ? [since] : []
    return this.db
      .prepare(
        `SELECT event_name, COUNT(*) as count FROM events ${where} GROUP BY event_name ORDER BY count DESC`,
      )
      .all(...params)
  }

  getUsageSummary(since?: string) {
    const where = since ? "WHERE event_name = 'tengu_api_success' AND created_at >= ?" : "WHERE event_name = 'tengu_api_success'"
    const params = since ? [since] : []
    const rows = this.db
      .prepare(`SELECT metadata FROM events ${where}`)
      .all(...params)

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadTokens = 0
    let totalCacheCreationTokens = 0
    let totalCostUSD = 0
    let apiCallCount = 0

    for (const row of rows) {
      try {
        const meta = JSON.parse((row as any).metadata)
        totalInputTokens += meta.input_tokens ?? 0
        totalOutputTokens += meta.output_tokens ?? 0
        totalCacheReadTokens += meta.cache_read_input_tokens ?? 0
        totalCacheCreationTokens += meta.cache_creation_input_tokens ?? 0
        totalCostUSD += meta.cost_usd ?? 0
        apiCallCount++
      } catch {
        // skip malformed
      }
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalCostUSD,
      apiCallCount,
    }
  }

  close() {
    this.db.close()
  }
}
