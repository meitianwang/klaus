/**
 * Postgres connection pool + Drizzle client + per-request RLS context helper.
 *
 * Decision #4 + RLS: every per-user query path must run inside `withUserScope`,
 * which acquires a dedicated client, calls `SET LOCAL app.current_user_id =
 * '<uuid>'`, runs the work in a transaction (so the GUC scopes correctly),
 * and releases. This guarantees no row leaks across tenants even if app code
 * forgets the WHERE clause.
 *
 * Admin / migration paths use `pool.query()` directly with a BYPASSRLS role
 * (see migrations/0001_rls_policies.sql for klaus_admin role definition).
 */

import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Db; // Drizzle's transaction body receives the same shape

let poolSingleton: Pool | null = null;
let dbSingleton: Db | null = null;

export interface PgConnectOptions {
  /** Postgres connection string. Env DATABASE_URL takes precedence. */
  url?: string;
  /** Max pool size. Default 10 — adjust per app server concurrency. */
  max?: number;
  /** Idle client timeout (ms). Default 30s. */
  idleTimeoutMillis?: number;
}

/** Lazily build the pool + drizzle client; subsequent calls return the same singletons. */
export function getDb(options: PgConnectOptions = {}): Db {
  if (dbSingleton) return dbSingleton;
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[db] DATABASE_URL is required for Postgres backend (set env or pass options.url)",
    );
  }
  poolSingleton = new Pool({
    connectionString: url,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
  });
  dbSingleton = drizzle(poolSingleton, { schema });
  return dbSingleton;
}

export function getPool(): Pool {
  if (!poolSingleton) getDb();
  return poolSingleton!;
}

/**
 * Run `fn` with `app.current_user_id` set to `userId` for the duration of a
 * single transaction. All queries inside `fn` see only that user's rows
 * (per RLS policy) — caller no longer needs to pass user_id explicitly.
 *
 * Throws if `userId` is empty / not a UUID — caller should validate session
 * before reaching here.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  if (!userId || typeof userId !== "string") {
    throw new Error("[db] withUserScope requires a non-empty userId");
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    // SET LOCAL is transaction-scoped; auto-reverts on commit/rollback.
    // Parameter binding via $1 is unsafe for SET (it expects a literal),
    // so we hex-validate the uuid + interpolate. UUID grammar = no SQL chars.
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new Error(`[db] invalid userId format: ${userId}`);
    }
    await tx.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { sql: `SET LOCAL app.current_user_id = '${userId}'`, params: [] } as any,
    );
    return await fn(tx);
  });
}

/**
 * For admin / migration scripts. No RLS bypass at the SQL level — that requires
 * connecting as the BYPASSRLS role (klaus_admin); using `klaus_app` here will
 * still see the empty result set if no user_id is set.
 *
 * The intended use is one-off DDL or analytic queries that read NO per-user
 * tables (e.g. invite_codes, platform_*).
 */
export async function withAdminClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Cleanly close all connections — useful for tests + graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (poolSingleton) {
    await poolSingleton.end();
    poolSingleton = null;
    dbSingleton = null;
  }
}

// Re-export schema for callers that want raw table access.
export * as schema from "./schema.js";
