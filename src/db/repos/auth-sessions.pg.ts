/**
 * AuthSessionsRepoPg — PG implementation of the auth_sessions repo.
 *
 * Mirrors src/db/repos/auth-sessions.ts (SQLite) but async.
 */

import { eq, lt, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { authSessions } from "../schema.js";

export interface AuthSessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip: string;
  user_agent: string;
}

export interface InsertAuthSessionParams {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
}

function toRow(r: typeof authSessions.$inferSelect): AuthSessionRow {
  return {
    token: r.token,
    user_id: r.userId,
    created_at: r.createdAt.getTime(),
    expires_at: r.expiresAt.getTime(),
    ip: r.ip ?? "",
    user_agent: r.userAgent ?? "",
  };
}

export class AuthSessionsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async insert(params: InsertAuthSessionParams): Promise<void> {
    await this.dbOrTx.insert(authSessions).values({
      token: params.token,
      userId: params.userId,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      createdAt: new Date(params.createdAt),
      expiresAt: new Date(params.expiresAt),
    });
  }

  async findByToken(token: string): Promise<AuthSessionRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(authSessions)
      .where(eq(authSessions.token, token))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async delete(token: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(authSessions)
      .where(eq(authSessions.token, token))
      .returning({ token: authSessions.token });
    return r.length > 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.dbOrTx
      .delete(authSessions)
      .where(eq(authSessions.userId, userId))
      .returning({ token: authSessions.token });
    return r.length;
  }

  async pruneExpired(beforeTs: number): Promise<number> {
    const r = await this.dbOrTx
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, new Date(beforeTs)))
      .returning({ token: authSessions.token });
    return r.length;
  }
}
