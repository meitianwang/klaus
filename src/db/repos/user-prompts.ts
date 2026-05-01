/**
 * UserPromptsRepo — pure data-access layer for the `user_prompts` table.
 *
 * Per-user custom prompts. Admin-managed prompts stay in the legacy `prompts`
 * table (treated as `platform_prompts`). UI is expected to merge both lists
 * with admin entries marked read-only.
 */

import { Database } from "bun:sqlite";

export interface UserPromptRow {
  id: string;
  user_id: string;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertUserPromptParams {
  id: string;
  userId: string;
  name: string;
  content: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

export class UserPromptsRepo {
  private readonly stmtList;
  private readonly stmtGetById;
  private readonly stmtUpsert;
  private readonly stmtDelete;
  private readonly stmtClearAllDefault;
  private readonly stmtSetDefault;
  private readonly stmtChanges;

  constructor(private readonly db: Database) {
    this.stmtList = db.prepare(
      "SELECT * FROM user_prompts WHERE user_id = ? ORDER BY is_default DESC, name ASC",
    );
    this.stmtGetById = db.prepare(
      "SELECT * FROM user_prompts WHERE id = ? AND user_id = ?",
    );
    this.stmtUpsert = db.prepare(
      `INSERT INTO user_prompts (id, user_id, name, content, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, content = excluded.content,
         is_default = excluded.is_default, updated_at = excluded.updated_at`,
    );
    this.stmtDelete = db.prepare(
      "DELETE FROM user_prompts WHERE id = ? AND user_id = ?",
    );
    this.stmtClearAllDefault = db.prepare(
      "UPDATE user_prompts SET is_default = 0 WHERE user_id = ?",
    );
    this.stmtSetDefault = db.prepare(
      "UPDATE user_prompts SET is_default = 1 WHERE id = ? AND user_id = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  listByUser(userId: string): readonly UserPromptRow[] {
    return this.stmtList.all(userId) as UserPromptRow[];
  }

  findById(id: string, userId: string): UserPromptRow | undefined {
    return this.stmtGetById.get(id, userId) as UserPromptRow | undefined;
  }

  upsert(p: UpsertUserPromptParams): void {
    this.stmtUpsert.run(
      p.id,
      p.userId,
      p.name,
      p.content,
      p.isDefault,
      p.createdAt,
      p.updatedAt,
    );
  }

  delete(id: string, userId: string): boolean {
    this.stmtDelete.run(id, userId);
    return this.lastChanges() > 0;
  }

  /** Atomically: clear is_default on all of user's prompts, then set on target id. */
  setDefault(id: string, userId: string): void {
    this.db.transaction(() => {
      this.stmtClearAllDefault.run(userId);
      this.stmtSetDefault.run(id, userId);
    })();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
