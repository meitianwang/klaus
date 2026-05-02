/**
 * UserSettingsRepoPg — PG implementation. Per-user typed KV preferences (RLS).
 * value is JSONB; caller passes/expects strings to match SQLite repo signature.
 */

import { and, eq } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { userSettings } from "../schema.js";

export interface UserSettingRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: number;
}

function toRow(r: typeof userSettings.$inferSelect): UserSettingRow {
  return {
    user_id: r.userId,
    key: r.key,
    // value is JSONB; if caller stored a JSON string, return as-is. If they
    // stored a complex object, JSON.stringify it back for parity with SQLite.
    value:
      typeof r.value === "string"
        ? r.value
        : JSON.stringify(r.value),
    updated_at: r.updatedAt.getTime(),
  };
}

export class UserSettingsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async findByKey(userId: string, key: string): Promise<string | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
      .limit(1);
    return r[0] ? toRow(r[0]).value : undefined;
  }

  async upsert(userId: string, key: string, value: string, ts: number): Promise<void> {
    await this.dbOrTx
      .insert(userSettings)
      .values({
        userId,
        key,
        value,
        updatedAt: new Date(ts),
      })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value, updatedAt: new Date(ts) },
      });
  }

  async listByUser(userId: string): Promise<readonly UserSettingRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return rows.map(toRow);
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
      .returning({ key: userSettings.key });
    return r.length > 0;
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.dbOrTx
      .delete(userSettings)
      .where(eq(userSettings.userId, userId))
      .returning({ key: userSettings.key });
    return r.length;
  }
}
