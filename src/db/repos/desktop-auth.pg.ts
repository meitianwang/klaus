/**
 * DesktopAuthRepoPg — PG implementation for desktop_auth_codes + desktop_tokens.
 *
 * Mirrors src/db/repos/desktop-auth.ts (SQLite) but async. The two tables share
 * one repo because they cooperate in the OAuth-style PKCE redemption flow.
 *
 * NOTE: SQLite version stores `used_at` as INTEGER 0 = unused. PG schema uses
 * a nullable TIMESTAMPTZ — the `findCode().used_at` epoch-ms returns 0 when
 * NULL to keep callers (UserStore.redeemDesktopAuthCode) unchanged.
 */

import { eq, or, lt, isNotNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { desktopAuthCodes, desktopTokens } from "../schema.js";

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

function codeToRow(r: typeof desktopAuthCodes.$inferSelect): DesktopAuthCodeRow {
  return {
    code: r.code,
    user_id: r.userId,
    state: r.state,
    code_challenge: r.codeChallenge,
    created_at: r.createdAt.getTime(),
    expires_at: r.expiresAt.getTime(),
    used_at: r.usedAt?.getTime() ?? 0,
  };
}

export class DesktopAuthRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  // -- Codes ---------------------------------------------------------------

  async insertCode(p: InsertDesktopCodeParams): Promise<void> {
    await this.dbOrTx.insert(desktopAuthCodes).values({
      code: p.code,
      userId: p.userId,
      state: p.state,
      codeChallenge: p.codeChallenge,
      createdAt: new Date(p.createdAt),
      expiresAt: new Date(p.expiresAt),
    });
  }

  async findCode(code: string): Promise<DesktopAuthCodeRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(desktopAuthCodes)
      .where(eq(desktopAuthCodes.code, code))
      .limit(1);
    return r[0] ? codeToRow(r[0]) : undefined;
  }

  async markCodeUsed(code: string, usedAt: number): Promise<void> {
    await this.dbOrTx
      .update(desktopAuthCodes)
      .set({ usedAt: new Date(usedAt) })
      .where(eq(desktopAuthCodes.code, code));
  }

  /** Delete codes whose expires_at < beforeTs OR already consumed. */
  async pruneCodes(beforeTs: number): Promise<number> {
    const r = await this.dbOrTx
      .delete(desktopAuthCodes)
      .where(
        or(
          lt(desktopAuthCodes.expiresAt, new Date(beforeTs)),
          isNotNull(desktopAuthCodes.usedAt),
        ),
      )
      .returning({ code: desktopAuthCodes.code });
    return r.length;
  }

  // -- Tokens --------------------------------------------------------------

  async insertToken(p: InsertDesktopTokenParams): Promise<void> {
    await this.dbOrTx.insert(desktopTokens).values({
      token: p.token,
      userId: p.userId,
      deviceInfo: p.deviceInfo,
      createdAt: new Date(p.createdAt),
      lastUsedAt: new Date(p.lastUsedAt),
    });
  }

  async findTokenUserId(token: string): Promise<string | undefined> {
    const r = await this.dbOrTx
      .select({ userId: desktopTokens.userId })
      .from(desktopTokens)
      .where(eq(desktopTokens.token, token))
      .limit(1);
    return r[0]?.userId;
  }

  async touchTokenLastUsed(token: string, ts: number): Promise<void> {
    await this.dbOrTx
      .update(desktopTokens)
      .set({ lastUsedAt: new Date(ts) })
      .where(eq(desktopTokens.token, token));
  }

  async deleteToken(token: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(desktopTokens)
      .where(eq(desktopTokens.token, token))
      .returning({ token: desktopTokens.token });
    return r.length > 0;
  }
}
