/**
 * AuthSessionsRepo — pure data-access layer for the `auth_sessions` table
 * (HttpOnly cookie sessions for the Web channel).
 *
 * Business rules (token generation, lifetime defaults, "validate = SELECT
 * + DELETE if invalid", user-agent truncation) live in the calling service
 * (UserStore), not here.
 */

import { Database } from "bun:sqlite";

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

export class AuthSessionsRepo {
  private readonly stmtInsert;
  private readonly stmtGet;
  private readonly stmtDelete;
  private readonly stmtDeleteByUser;
  private readonly stmtPrune;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO auth_sessions (token, user_id, created_at, expires_at, ip, user_agent)
      VALUES (@token, @userId, @createdAt, @expiresAt, @ip, @userAgent)
    `);
    this.stmtGet = db.prepare("SELECT * FROM auth_sessions WHERE token = ?");
    this.stmtDelete = db.prepare("DELETE FROM auth_sessions WHERE token = ?");
    this.stmtDeleteByUser = db.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ?",
    );
    this.stmtPrune = db.prepare(
      "DELETE FROM auth_sessions WHERE expires_at < ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  insert(params: InsertAuthSessionParams): void {
    this.stmtInsert.run({
      "@token": params.token,
      "@userId": params.userId,
      "@createdAt": params.createdAt,
      "@expiresAt": params.expiresAt,
      "@ip": params.ip,
      "@userAgent": params.userAgent,
    });
  }

  findByToken(token: string): AuthSessionRow | undefined {
    return this.stmtGet.get(token) as AuthSessionRow | undefined;
  }

  delete(token: string): boolean {
    this.stmtDelete.run(token);
    return this.lastChanges() > 0;
  }

  deleteByUser(userId: string): number {
    this.stmtDeleteByUser.run(userId);
    return this.lastChanges();
  }

  /** Delete all sessions whose `expires_at` is older than `beforeTs`. */
  pruneExpired(beforeTs: number): number {
    this.stmtPrune.run(beforeTs);
    return this.lastChanges();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
