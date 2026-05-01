/**
 * PromptsRepo — pure data-access layer for the `prompts` table (semantically:
 * platform-level system prompts, admin-managed, no user_id).
 *
 * Per Phase 0 split, per-user custom prompts live in a separate table
 * (`user_prompts`) with their own repo (UserPromptsRepo).
 */

import { Database } from "bun:sqlite";

export interface PromptRow {
  id: string;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertPromptParams {
  id: string;
  name: string;
  content: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

export class PromptsRepo {
  private readonly stmtList;
  private readonly stmtGetById;
  private readonly stmtGetDefault;
  private readonly stmtGetFirst;
  private readonly stmtUpsert;
  private readonly stmtDelete;
  private readonly stmtClearAllDefault;
  private readonly stmtSetDefault;
  private readonly stmtChanges;

  constructor(private readonly db: Database) {
    this.stmtList = db.prepare(
      "SELECT * FROM prompts ORDER BY is_default DESC, name ASC",
    );
    this.stmtGetById = db.prepare("SELECT * FROM prompts WHERE id = ?");
    this.stmtGetDefault = db.prepare(
      "SELECT * FROM prompts WHERE is_default = 1 LIMIT 1",
    );
    // Deterministic fallback when no default is set: oldest first.
    this.stmtGetFirst = db.prepare(
      "SELECT * FROM prompts ORDER BY created_at ASC LIMIT 1",
    );
    this.stmtUpsert = db.prepare(
      `INSERT INTO prompts (id, name, content, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, content = excluded.content,
         is_default = excluded.is_default, updated_at = excluded.updated_at`,
    );
    this.stmtDelete = db.prepare("DELETE FROM prompts WHERE id = ?");
    this.stmtClearAllDefault = db.prepare("UPDATE prompts SET is_default = 0");
    this.stmtSetDefault = db.prepare(
      "UPDATE prompts SET is_default = 1 WHERE id = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  list(): readonly PromptRow[] {
    return this.stmtList.all() as PromptRow[];
  }

  findById(id: string): PromptRow | undefined {
    return this.stmtGetById.get(id) as PromptRow | undefined;
  }

  findDefault(): PromptRow | undefined {
    return this.stmtGetDefault.get() as PromptRow | undefined;
  }

  findFirst(): PromptRow | undefined {
    return this.stmtGetFirst.get() as PromptRow | undefined;
  }

  upsert(p: UpsertPromptParams): void {
    this.stmtUpsert.run(
      p.id,
      p.name,
      p.content,
      p.isDefault,
      p.createdAt,
      p.updatedAt,
    );
  }

  delete(id: string): boolean {
    this.stmtDelete.run(id);
    return this.lastChanges() > 0;
  }

  setDefault(id: string): void {
    this.db.transaction(() => {
      this.stmtClearAllDefault.run();
      this.stmtSetDefault.run(id);
    })();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
