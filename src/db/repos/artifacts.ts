/**
 * ArtifactsRepo — pure data-access layer for the `session_artifacts` table.
 *
 * This table indexes which file paths a session's agent has Write/Edit/NotebookEdit'd
 * (used by the desktop "outputs" panel). Actual file contents are written by the
 * CC engine to the local filesystem (decision #5: not migrated).
 *
 * Business rules (Op enum mapping, "first_seen preserved on update" semantics)
 * live in the calling service (SettingsStore).
 */

import { Database } from "bun:sqlite";

export interface ArtifactRow {
  session_key: string;
  file_path: string;
  last_op: string;
  first_seen_at: number;
  last_modified_at: number;
  user_id?: string | null;
}

export class ArtifactsRepo {
  private readonly stmtUpsert;
  private readonly stmtUpsertWithUser;
  private readonly stmtGet;
  private readonly stmtList;
  private readonly stmtDeleteBySession;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtUpsert = db.prepare(
      `INSERT INTO session_artifacts (session_key, file_path, last_op, first_seen_at, last_modified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_key, file_path) DO UPDATE SET
         last_op = excluded.last_op,
         last_modified_at = excluded.last_modified_at`,
    );
    this.stmtUpsertWithUser = db.prepare(
      `INSERT INTO session_artifacts (session_key, user_id, file_path, last_op, first_seen_at, last_modified_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_key, file_path) DO UPDATE SET
         user_id = excluded.user_id,
         last_op = excluded.last_op,
         last_modified_at = excluded.last_modified_at`,
    );
    this.stmtGet = db.prepare(
      "SELECT session_key, file_path, last_op, first_seen_at, last_modified_at FROM session_artifacts WHERE session_key = ? AND file_path = ?",
    );
    this.stmtList = db.prepare(
      "SELECT session_key, file_path, last_op, first_seen_at, last_modified_at FROM session_artifacts WHERE session_key = ? ORDER BY last_modified_at DESC",
    );
    this.stmtDeleteBySession = db.prepare(
      "DELETE FROM session_artifacts WHERE session_key = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  upsert(
    sessionKey: string,
    filePath: string,
    op: string,
    ts: number,
  ): void {
    this.stmtUpsert.run(sessionKey, filePath, op, ts, ts);
  }

  /** Phase 0: same as upsert but populates the user_id column for RLS-friendly queries. */
  upsertWithUser(
    sessionKey: string,
    userId: string,
    filePath: string,
    op: string,
    ts: number,
  ): void {
    this.stmtUpsertWithUser.run(sessionKey, userId, filePath, op, ts, ts);
  }

  findBySessionAndPath(sessionKey: string, filePath: string): ArtifactRow | undefined {
    return this.stmtGet.get(sessionKey, filePath) as ArtifactRow | undefined;
  }

  listBySession(sessionKey: string): readonly ArtifactRow[] {
    return this.stmtList.all(sessionKey) as ArtifactRow[];
  }

  deleteBySession(sessionKey: string): number {
    this.stmtDeleteBySession.run(sessionKey);
    return this.lastChanges();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
