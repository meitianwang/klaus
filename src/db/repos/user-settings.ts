/**
 * UserSettingsRepo — pure data-access layer for the `user_settings` table.
 *
 * Per-user typed key-value preferences (language, theme, output_style, etc.).
 *
 * Phase 0 split: previously these were stored in the global `settings` KV
 * with composite keys like `user.<userId>.language`. The legacy data path
 * is preserved for now (see SettingsStore.getUserLanguage); new code reads
 * from this dedicated table for clean per-user RLS in the future.
 */

import { Database } from "bun:sqlite";

export interface UserSettingRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: number;
}

export class UserSettingsRepo {
  private readonly stmtGet;
  private readonly stmtSet;
  private readonly stmtListByUser;
  private readonly stmtDelete;
  private readonly stmtDeleteByUser;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtGet = db.prepare(
      "SELECT * FROM user_settings WHERE user_id = ? AND key = ?",
    );
    this.stmtSet = db.prepare(
      `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.stmtListByUser = db.prepare(
      "SELECT * FROM user_settings WHERE user_id = ?",
    );
    this.stmtDelete = db.prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key = ?",
    );
    this.stmtDeleteByUser = db.prepare(
      "DELETE FROM user_settings WHERE user_id = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  findByKey(userId: string, key: string): string | undefined {
    const row = this.stmtGet.get(userId, key) as UserSettingRow | undefined;
    return row?.value;
  }

  upsert(userId: string, key: string, value: string, ts: number): void {
    this.stmtSet.run(userId, key, value, ts);
  }

  listByUser(userId: string): readonly UserSettingRow[] {
    return this.stmtListByUser.all(userId) as UserSettingRow[];
  }

  delete(userId: string, key: string): boolean {
    this.stmtDelete.run(userId, key);
    return this.lastChanges() > 0;
  }

  deleteByUser(userId: string): number {
    this.stmtDeleteByUser.run(userId);
    return this.lastChanges();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
