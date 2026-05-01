/**
 * DesktopAuthRepo — pure data-access layer for the `desktop_auth_codes` and
 * `desktop_tokens` tables (desktop OAuth-style PKCE flow).
 *
 * Both tables are part of one flow, so they share a repo to keep
 * `redeemDesktopAuthCode` (mark code used + issue token, atomically) on a
 * single transaction surface.
 *
 * Business rules (PKCE verification, token generation, device_info truncation,
 * 5-minute TTL policy, "validate = SELECT + DELETE if invalid") live in the
 * calling service (UserStore), not here.
 */

import { Database } from "bun:sqlite";

export interface DesktopAuthCodeRow {
  code: string;
  user_id: string;
  state: string;
  code_challenge: string;
  created_at: number;
  expires_at: number;
  used_at: number;
}

export interface InsertDesktopCodeParams {
  code: string;
  userId: string;
  state: string;
  codeChallenge: string;
  createdAt: number;
  expiresAt: number;
}

export interface InsertDesktopTokenParams {
  token: string;
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  deviceInfo: string;
}

export class DesktopAuthRepo {
  private readonly stmtInsertCode;
  private readonly stmtFindCode;
  private readonly stmtMarkCodeUsed;
  private readonly stmtPruneCodes;
  private readonly stmtInsertToken;
  private readonly stmtFindTokenUserId;
  private readonly stmtTouchTokenLastUsed;
  private readonly stmtDeleteToken;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtInsertCode = db.prepare(`
      INSERT INTO desktop_auth_codes (code, user_id, state, code_challenge, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.stmtFindCode = db.prepare(
      "SELECT * FROM desktop_auth_codes WHERE code = ?",
    );
    this.stmtMarkCodeUsed = db.prepare(
      "UPDATE desktop_auth_codes SET used_at = ? WHERE code = ?",
    );
    this.stmtPruneCodes = db.prepare(
      "DELETE FROM desktop_auth_codes WHERE expires_at < ? OR used_at > 0",
    );
    this.stmtInsertToken = db.prepare(`
      INSERT INTO desktop_tokens (token, user_id, created_at, last_used_at, device_info)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmtFindTokenUserId = db.prepare(
      "SELECT user_id FROM desktop_tokens WHERE token = ?",
    );
    this.stmtTouchTokenLastUsed = db.prepare(
      "UPDATE desktop_tokens SET last_used_at = ? WHERE token = ?",
    );
    this.stmtDeleteToken = db.prepare(
      "DELETE FROM desktop_tokens WHERE token = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  // -- Authorization codes ---------------------------------------------------

  insertCode(params: InsertDesktopCodeParams): void {
    this.stmtInsertCode.run(
      params.code,
      params.userId,
      params.state,
      params.codeChallenge,
      params.createdAt,
      params.expiresAt,
    );
  }

  findCode(code: string): DesktopAuthCodeRow | undefined {
    return this.stmtFindCode.get(code) as DesktopAuthCodeRow | undefined;
  }

  markCodeUsed(code: string, usedAt: number): void {
    this.stmtMarkCodeUsed.run(usedAt, code);
  }

  /** Delete codes whose `expires_at` is older than `beforeTs`, or already consumed. */
  pruneCodes(beforeTs: number): number {
    this.stmtPruneCodes.run(beforeTs);
    return this.lastChanges();
  }

  // -- Long-lived bearer tokens ---------------------------------------------

  insertToken(params: InsertDesktopTokenParams): void {
    this.stmtInsertToken.run(
      params.token,
      params.userId,
      params.createdAt,
      params.lastUsedAt,
      params.deviceInfo,
    );
  }

  /** Look up which user a token belongs to. Does NOT touch last_used_at. */
  findTokenUserId(token: string): string | undefined {
    const row = this.stmtFindTokenUserId.get(token) as
      | { user_id: string }
      | undefined;
    return row?.user_id;
  }

  touchTokenLastUsed(token: string, ts: number): void {
    this.stmtTouchTokenLastUsed.run(ts, token);
  }

  deleteToken(token: string): boolean {
    this.stmtDeleteToken.run(token);
    return this.lastChanges() > 0;
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
