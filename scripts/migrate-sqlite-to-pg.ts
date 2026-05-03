/**
 * One-shot migration: ~/.klaus/*.db (SQLite) → PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun scripts/migrate-sqlite-to-pg.ts
 *
 * Safe to run repeatedly — all inserts use ON CONFLICT DO NOTHING.
 * Skipped tables: rules (no PG equivalent), analytics.db (telemetry only).
 */

import { Database } from "bun:sqlite";
import pg from "pg";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_DIR = join(homedir(), ".klaus");
const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
  console.error("❌  DATABASE_URL is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msToTs(ms: number | null | undefined): Date | null {
  if (!ms || ms === 0) return null;
  return new Date(ms);
}

function intToBool(v: number | null | undefined): boolean {
  return v === 1;
}

function openDb(name: string): Database {
  const path = join(DB_DIR, `${name}.db`);
  return new Database(path, { readonly: true });
}

async function run<T>(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<pg.QueryResult<T>> {
  return client.query<T>(sql, params as pg.QueryConfigValues<T>);
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: PG_URL, max: 3 });

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await migrateUsers(client);
    await migrateInvites(client);
    await migrateSettings(client);
    await migrateKlausDb(client);
    console.log("\n✅  Migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// users.db: users, auth_sessions, desktop_auth_codes, desktop_tokens
// ---------------------------------------------------------------------------

async function migrateUsers(client: pg.PoolClient): Promise<void> {
  const db = openDb("users");

  // --- users ---
  const users = db.query("SELECT * FROM users").all() as Record<string, unknown>[];
  let inserted = 0;
  for (const u of users) {
    const r = await run(client, `
      INSERT INTO users (
        id, email, password_hash, display_name, avatar_url,
        role, google_id, invite_code, is_active,
        failed_attempts, locked_until, created_at, last_login_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO NOTHING
    `, [
      u.id,
      u.email,
      u.password_hash ?? "",
      u.display_name ?? "",
      u.avatar_url ?? null,
      u.role ?? "user",
      u.google_id ?? null,
      u.invite_code ?? "",
      intToBool(u.is_active as number),
      u.failed_attempts ?? 0,
      msToTs(u.locked_until as number),
      msToTs(u.created_at as number) ?? new Date(),
      msToTs(u.last_login_at as number),
    ]);
    inserted += r.rowCount ?? 0;
  }
  console.log(`users:              ${formatCount(inserted)} / ${formatCount(users.length)} inserted`);

  // --- auth_sessions ---
  const sessions = db.query("SELECT * FROM auth_sessions").all() as Record<string, unknown>[];
  inserted = 0;
  for (const s of sessions) {
    const r = await run(client, `
      INSERT INTO auth_sessions (token, user_id, created_at, expires_at, ip, user_agent)
      VALUES ($1,$2::uuid,$3,$4,$5,$6)
      ON CONFLICT (token) DO NOTHING
    `, [
      s.token,
      s.user_id,
      msToTs(s.created_at as number) ?? new Date(),
      msToTs(s.expires_at as number) ?? new Date(),
      s.ip ?? "",
      s.user_agent ?? "",
    ]);
    inserted += r.rowCount ?? 0;
  }
  console.log(`auth_sessions:      ${formatCount(inserted)} / ${formatCount(sessions.length)} inserted`);

  // --- desktop_auth_codes ---
  const codes = db.query("SELECT * FROM desktop_auth_codes").all() as Record<string, unknown>[];
  inserted = 0;
  for (const c of codes) {
    const r = await run(client, `
      INSERT INTO desktop_auth_codes (
        code, user_id, state, code_challenge, created_at, expires_at, used_at
      ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7)
      ON CONFLICT (code) DO NOTHING
    `, [
      c.code,
      c.user_id,
      c.state ?? "",
      c.code_challenge ?? "",
      msToTs(c.created_at as number) ?? new Date(),
      msToTs(c.expires_at as number) ?? new Date(),
      (c.used_at as number) > 0 ? msToTs(c.used_at as number) : null,
    ]);
    inserted += r.rowCount ?? 0;
  }
  console.log(`desktop_auth_codes: ${formatCount(inserted)} / ${formatCount(codes.length)} inserted`);

  // --- desktop_tokens ---
  const tokens = db.query("SELECT * FROM desktop_tokens").all() as Record<string, unknown>[];
  inserted = 0;
  for (const t of tokens) {
    const r = await run(client, `
      INSERT INTO desktop_tokens (token, user_id, created_at, last_used_at, device_info)
      VALUES ($1,$2::uuid,$3,$4,$5)
      ON CONFLICT (token) DO NOTHING
    `, [
      t.token,
      t.user_id,
      msToTs(t.created_at as number) ?? new Date(),
      msToTs(t.last_used_at as number) ?? new Date(),
      t.device_info ?? "",
    ]);
    inserted += r.rowCount ?? 0;
  }
  console.log(`desktop_tokens:     ${formatCount(inserted)} / ${formatCount(tokens.length)} inserted`);

  db.close();
}

// ---------------------------------------------------------------------------
// invites.db: invite_codes
// ---------------------------------------------------------------------------

async function migrateInvites(client: pg.PoolClient): Promise<void> {
  const db = openDb("invites");
  const rows = db.query("SELECT * FROM invite_codes").all() as Record<string, unknown>[];
  let inserted = 0;
  for (const r of rows) {
    const res = await run(client, `
      INSERT INTO invite_codes (code, label, is_active, used_by, used_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (code) DO NOTHING
    `, [
      r.code,
      r.label ?? "",
      intToBool(r.is_active as number),
      r.used_by ?? null,
      (r.used_at as number) > 0 ? msToTs(r.used_at as number) : null,
      msToTs(r.created_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`invite_codes:       ${formatCount(inserted)} / ${formatCount(rows.length)} inserted`);
  db.close();
}

// ---------------------------------------------------------------------------
// settings.db: models, prompts, settings, cron_tasks, cron_runs,
//              session_artifacts, mcp_servers
// ---------------------------------------------------------------------------

async function migrateSettings(client: pg.PoolClient): Promise<void> {
  const db = openDb("settings");

  // --- models → platform_models ---
  const models = db.query("SELECT * FROM models").all() as Record<string, unknown>[];
  let inserted = 0;
  for (const m of models) {
    const res = await run(client, `
      INSERT INTO platform_models (
        id, name, provider, model, base_url, max_context_tokens,
        thinking, is_default, role,
        cost_input, cost_output, cost_cache_read, cost_cache_write,
        auth_type, refresh_token, token_expires_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO NOTHING
    `, [
      m.id,
      m.name,
      m.provider ?? "anthropic",
      m.model,
      m.base_url ?? null,
      m.max_context_tokens ?? 200000,
      m.thinking ?? "off",
      intToBool(m.is_default as number),
      m.role ?? null,
      m.cost_input ?? null,
      m.cost_output ?? null,
      m.cost_cache_read ?? null,
      m.cost_cache_write ?? null,
      m.auth_type ?? "api_key",
      m.refresh_token ?? null,
      m.token_expires_at ?? null,
      msToTs(m.created_at as number) ?? new Date(),
      msToTs(m.updated_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`platform_models:    ${formatCount(inserted)} / ${formatCount(models.length)} inserted`);

  // --- prompts → platform_prompts ---
  const prompts = db.query("SELECT * FROM prompts").all() as Record<string, unknown>[];
  inserted = 0;
  for (const p of prompts) {
    const res = await run(client, `
      INSERT INTO platform_prompts (id, name, content, is_default, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING
    `, [
      p.id,
      p.name,
      p.content,
      intToBool(p.is_default as number),
      msToTs(p.created_at as number) ?? new Date(),
      msToTs(p.updated_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`platform_prompts:   ${formatCount(inserted)} / ${formatCount(prompts.length)} inserted`);

  // --- settings → platform_settings ---
  const settings = db.query("SELECT * FROM settings").all() as Record<string, unknown>[];
  inserted = 0;
  for (const s of settings) {
    const res = await run(client, `
      INSERT INTO platform_settings (key, value)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key) DO NOTHING
    `, [
      s.key,
      JSON.stringify(s.value),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`platform_settings:  ${formatCount(inserted)} / ${formatCount(settings.length)} inserted`);

  // --- cron_tasks ---
  // PG schema: user_id is NOT NULL uuid — skip tasks without a user (system tasks)
  const tasks = db.query("SELECT * FROM cron_tasks WHERE user_id IS NOT NULL").all() as Record<string, unknown>[];
  inserted = 0;
  let skipped = 0;
  for (const t of tasks) {
    const deliver = t.deliver ? JSON.stringify(typeof t.deliver === "string" ? JSON.parse(t.deliver) : t.deliver) : null;
    const failureAlert = t.failure_alert ? JSON.stringify(typeof t.failure_alert === "string" ? JSON.parse(t.failure_alert) : t.failure_alert) : null;
    try {
      const res = await run(client, `
        INSERT INTO cron_tasks (
          id, user_id, name, description, schedule, prompt, enabled,
          thinking, light_context, timeout_seconds, delete_after_run,
          deliver, webhook_url, webhook_token, failure_alert,
          created_at, updated_at
        ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16,$17)
        ON CONFLICT (id) DO NOTHING
      `, [
        t.id,
        t.user_id,
        t.name ?? null,
        t.description ?? null,
        t.schedule,
        t.prompt,
        intToBool(t.enabled as number),
        t.thinking ?? null,
        intToBool(t.light_context as number),
        t.timeout_seconds ?? null,
        intToBool(t.delete_after_run as number),
        deliver,
        t.webhook_url ?? null,
        t.webhook_token ?? null,
        failureAlert,
        msToTs(t.created_at as number) ?? new Date(),
        msToTs(t.updated_at as number) ?? new Date(),
      ]);
      inserted += res.rowCount ?? 0;
    } catch {
      // user_id FK violation (user not migrated) — skip
      skipped++;
    }
  }
  const totalSqlite = db.query("SELECT COUNT(*) as n FROM cron_tasks").get() as { n: number };
  console.log(`cron_tasks:         ${formatCount(inserted)} / ${formatCount(tasks.length)} inserted${skipped > 0 ? ` (${skipped} skipped — FK/no-user)` : ""} (${totalSqlite.n - tasks.length} had no user_id)`);

  // --- cron_runs ---
  const runs = db.query("SELECT * FROM cron_runs").all() as Record<string, unknown>[];
  inserted = 0;
  for (const r of runs) {
    const res = await run(client, `
      INSERT INTO cron_runs (
        task_id, task_name, started_at, finished_at, duration_ms,
        trigger_type, status, error, session_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT DO NOTHING
    `, [
      r.task_id,
      r.task_name ?? "",
      msToTs(r.started_at as number) ?? new Date(),
      msToTs(r.finished_at as number),
      r.duration_ms ?? null,
      r.trigger_type ?? "scheduled",
      r.status ?? "done",
      r.error ?? null,
      r.session_id ?? "",
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`cron_runs:          ${formatCount(inserted)} / ${formatCount(runs.length)} inserted`);

  // --- session_artifacts ---
  const artifacts = db.query("SELECT * FROM session_artifacts").all() as Record<string, unknown>[];
  inserted = 0;
  for (const a of artifacts) {
    const res = await run(client, `
      INSERT INTO session_artifacts (session_id, file_path, last_op, first_seen_at, last_modified_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (session_id, file_path) DO NOTHING
    `, [
      a.session_id,
      a.file_path,
      a.last_op ?? "write",
      msToTs(a.first_seen_at as number) ?? new Date(),
      msToTs(a.last_modified_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`session_artifacts:  ${formatCount(inserted)} / ${formatCount(artifacts.length)} inserted`);

  // --- mcp_servers ---
  const mcpServers = db.query("SELECT * FROM mcp_servers").all() as Record<string, unknown>[];
  inserted = 0;
  for (const m of mcpServers) {
    const res = await run(client, `
      INSERT INTO mcp_servers (id, name, transport, enabled, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING
    `, [
      m.id,
      m.name,
      m.transport ?? "stdio",
      intToBool(m.enabled as number),
      msToTs(m.created_at as number) ?? new Date(),
      msToTs(m.updated_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`mcp_servers:        ${formatCount(inserted)} / ${formatCount(mcpServers.length)} inserted`);

  db.close();
}

// ---------------------------------------------------------------------------
// klaus.db: sessions
// ---------------------------------------------------------------------------

async function migrateKlausDb(client: pg.PoolClient): Promise<void> {
  const db = openDb("klaus");
  const sessions = db.query("SELECT * FROM sessions").all() as Record<string, unknown>[];
  let inserted = 0;
  for (const s of sessions) {
    const res = await run(client, `
      INSERT INTO sessions (session_key, session_id, model, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (session_key) DO NOTHING
    `, [
      s.session_key,
      s.session_id ?? s.session_key,
      s.model ?? null,
      msToTs(s.created_at as number) ?? new Date(),
      msToTs(s.updated_at as number) ?? new Date(),
    ]);
    inserted += res.rowCount ?? 0;
  }
  console.log(`sessions:           ${formatCount(inserted)} / ${formatCount(sessions.length)} inserted`);
  db.close();
}

migrate().catch((err) => {
  console.error("❌  Migration failed:", err);
  process.exit(1);
});
