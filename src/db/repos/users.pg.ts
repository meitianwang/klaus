/**
 * UsersRepoPg — Postgres + Drizzle implementation of the users repo.
 *
 * Mirrors the SQLite UsersRepo's responsibilities (pure data access for the
 * `users` table) but every method returns a Promise — Drizzle's PG driver is
 * async. Business rules (password hashing, email normalization, brute-force
 * thresholds) still live in UserStore upstream.
 *
 * RLS NOTE: This repo does NOT inject `app.current_user_id`. Caller must
 * either:
 *   - Wrap calls in `withUserScope(userId, async (tx) => { ... })` from
 *     src/db/connection.ts, OR
 *   - Connect as the `klaus_admin` BYPASSRLS role (admin paths only).
 *
 * UserRow shape stays identical to the SQLite repo's UserRow (so rowToUser()
 * in user-store.ts can stay unchanged) — Drizzle is configured to return
 * snake_case keys via mapping in the calling code.
 */

import { eq, sql, desc } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { users } from "../schema.js";

/** Snake-case row shape — matches SQLite UserRow so callers stay unchanged. */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  avatar_url: string | null;
  google_id: string | null;
  invite_code: string;
  created_at: number;
  last_login_at: number;
  is_active: number;
  failed_attempts: number;
  locked_until: number;
}

export interface InsertUserParams {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  googleId: string | null;
  inviteCode: string;
  createdAt: number;
  lastLoginAt: number;
  isActive: number;
}

/**
 * Map a Drizzle PG row (camelCase + Date instances) to the snake-case +
 * epoch-ms UserRow that UserStore.rowToUser() expects.
 */
function toRow(r: typeof users.$inferSelect): UserRow {
  return {
    id: r.id,
    email: r.email,
    password_hash: r.passwordHash,
    display_name: r.displayName,
    role: r.role,
    avatar_url: r.avatarUrl,
    google_id: r.googleId,
    invite_code: r.inviteCode,
    created_at: r.createdAt.getTime(),
    last_login_at: r.lastLoginAt?.getTime() ?? 0,
    is_active: r.isActive ? 1 : 0,
    failed_attempts: r.failedAttempts,
    locked_until: r.lockedUntil?.getTime() ?? 0,
  };
}

export class UsersRepoPg {
  /** `dbOrTx` may be the global Db or a transaction handle (from withUserScope). */
  constructor(private readonly dbOrTx: Db | DbTx) {}

  // -- Reads -----------------------------------------------------------------

  async count(): Promise<number> {
    const rows = await this.dbOrTx
      .select({ c: sql<number>`count(*)::int` })
      .from(users);
    return rows[0]?.c ?? 0;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  /** Caller is responsible for normalizing email (CITEXT handles case-insensitivity). */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findByGoogleId(googleId: string): Promise<UserRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(users)
      .where(eq(users.googleId, googleId))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async list(): Promise<readonly UserRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));
    return rows.map(toRow);
  }

  // -- Writes ----------------------------------------------------------------

  async insert(params: InsertUserParams): Promise<void> {
    await this.dbOrTx.insert(users).values({
      id: params.id,
      email: params.email,
      passwordHash: params.passwordHash,
      displayName: params.displayName,
      role: params.role,
      googleId: params.googleId,
      inviteCode: params.inviteCode,
      createdAt: new Date(params.createdAt),
      lastLoginAt: new Date(params.lastLoginAt),
      isActive: params.isActive === 1,
      // monthlyTokenQuota / monthlyTokenUsed / quotaResetAt take defaults
    });
  }

  async updateLastLogin(id: string, ts: number): Promise<void> {
    await this.dbOrTx
      .update(users)
      .set({ lastLoginAt: new Date(ts) })
      .where(eq(users.id, id));
  }

  async setActive(id: string, active: boolean): Promise<boolean> {
    const r = await this.dbOrTx
      .update(users)
      .set({ isActive: active })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return r.length > 0;
  }

  async setRole(id: string, role: "admin" | "user"): Promise<boolean> {
    const r = await this.dbOrTx
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return r.length > 0;
  }

  async setDisplayName(id: string, displayName: string): Promise<boolean> {
    const r = await this.dbOrTx
      .update(users)
      .set({ displayName })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return r.length > 0;
  }

  async setAvatarUrl(id: string, avatarUrl: string | null): Promise<boolean> {
    const r = await this.dbOrTx
      .update(users)
      .set({ avatarUrl })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return r.length > 0;
  }

  async linkGoogle(id: string, googleId: string): Promise<void> {
    await this.dbOrTx
      .update(users)
      .set({ googleId })
      .where(eq(users.id, id));
  }

  // -- Brute-force protection -----------------------------------------------

  async incrFailedAttempts(id: string): Promise<void> {
    await this.dbOrTx
      .update(users)
      .set({ failedAttempts: sql`${users.failedAttempts} + 1` })
      .where(eq(users.id, id));
  }

  async lockUser(id: string, until: number): Promise<void> {
    await this.dbOrTx
      .update(users)
      .set({ lockedUntil: new Date(until) })
      .where(eq(users.id, id));
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.dbOrTx
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, id));
  }
}
