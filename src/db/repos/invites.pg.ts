/**
 * InvitesRepoPg — PG implementation of the invites repo.
 *
 * Mirrors src/db/repos/invites.ts (SQLite) but async.
 *
 * Note: SQLite stores `is_active` as INTEGER 0/1 + `used_at` as INTEGER ms.
 * PG uses BOOLEAN + TIMESTAMPTZ. The repo translates so callers don't change.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { inviteCodes } from "../schema.js";

export interface InviteRow {
  code: string;
  label: string;
  created_at: number;
  is_active: number; // 1/0 for caller compatibility
  used_by: string | null;
  used_at: number | null;
}

function toRow(r: typeof inviteCodes.$inferSelect): InviteRow {
  return {
    code: r.code,
    label: r.label,
    created_at: r.createdAt.getTime(),
    is_active: r.isActive ? 1 : 0,
    used_by: r.usedBy,
    used_at: r.usedAt?.getTime() ?? null,
  };
}

export class InvitesRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async list(): Promise<readonly InviteRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(inviteCodes)
      .orderBy(sql`${inviteCodes.createdAt} DESC`);
    return rows.map(toRow);
  }

  async get(code: string): Promise<InviteRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async isValid(code: string): Promise<boolean> {
    const r = await this.dbOrTx
      .select({ code: inviteCodes.code })
      .from(inviteCodes)
      .where(and(eq(inviteCodes.code, code), eq(inviteCodes.isActive, true)))
      .limit(1);
    return r.length > 0;
  }

  async insert(params: {
    code: string;
    label: string;
    createdAt: number;
    isActive: number;
  }): Promise<void> {
    await this.dbOrTx.insert(inviteCodes).values({
      code: params.code,
      label: params.label,
      isActive: params.isActive === 1,
      createdAt: new Date(params.createdAt),
    });
  }

  async consume(code: string, usedBy: string, usedAt: number): Promise<boolean> {
    const r = await this.dbOrTx
      .update(inviteCodes)
      .set({ isActive: false, usedBy, usedAt: new Date(usedAt) })
      .where(and(eq(inviteCodes.code, code), eq(inviteCodes.isActive, true)))
      .returning({ code: inviteCodes.code });
    return r.length > 0;
  }

  async delete(code: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .returning({ code: inviteCodes.code });
    return r.length > 0;
  }
}
