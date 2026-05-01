/**
 * SessionsRepo — pure data-access layer for the `sessions` index table.
 *
 * Klaus-side metadata only (title / cwd / transcript_path / last_active_at).
 * Per decision #5, the actual conversation transcript stays in CC engine's
 * local JSONL file at `transcript_path` and is NOT migrated to a database.
 *
 * Phase 0 introduces this table to give the session list UI a queryable index
 * without crawling the JSONL directory; data is populated on session create
 * and updated on each user message.
 */

import { Database } from "bun:sqlite";

export interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  cwd: string | null;
  transcript_path: string | null;
  created_at: number;
  last_active_at: number | null;
}

export interface UpsertSessionParams {
  id: string;
  userId: string;
  title: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  createdAt: number;
  lastActiveAt: number | null;
}

export class SessionsRepo {
  private readonly stmtUpsert;
  private readonly stmtFindById;
  private readonly stmtListByUser;
  private readonly stmtTouch;
  private readonly stmtRename;
  private readonly stmtDelete;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtUpsert = db.prepare(
      `INSERT INTO sessions (id, user_id, title, cwd, transcript_path, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         cwd = excluded.cwd,
         transcript_path = excluded.transcript_path,
         last_active_at = excluded.last_active_at`,
    );
    this.stmtFindById = db.prepare("SELECT * FROM sessions WHERE id = ?");
    this.stmtListByUser = db.prepare(
      "SELECT * FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC NULLS LAST",
    );
    this.stmtTouch = db.prepare(
      "UPDATE sessions SET last_active_at = ? WHERE id = ?",
    );
    this.stmtRename = db.prepare(
      "UPDATE sessions SET title = ? WHERE id = ?",
    );
    this.stmtDelete = db.prepare("DELETE FROM sessions WHERE id = ?");
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  upsert(p: UpsertSessionParams): void {
    this.stmtUpsert.run(
      p.id,
      p.userId,
      p.title,
      p.cwd,
      p.transcriptPath,
      p.createdAt,
      p.lastActiveAt,
    );
  }

  findById(id: string): SessionRow | undefined {
    return this.stmtFindById.get(id) as SessionRow | undefined;
  }

  listByUser(userId: string): readonly SessionRow[] {
    return this.stmtListByUser.all(userId) as SessionRow[];
  }

  touch(id: string, ts: number): void {
    this.stmtTouch.run(ts, id);
  }

  rename(id: string, title: string): boolean {
    this.stmtRename.run(title, id);
    return this.lastChanges() > 0;
  }

  delete(id: string): boolean {
    this.stmtDelete.run(id);
    return this.lastChanges() > 0;
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
