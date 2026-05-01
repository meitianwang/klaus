/**
 * CronRunsRepo — pure data-access layer for the `cron_runs` table.
 *
 * Records each cron task execution: started/finished timestamps, status, error.
 * Used for audit trail / failure investigation. Not in the hot read path.
 */

import { Database } from "bun:sqlite";

export interface CronRunRow {
  id: number;
  task_id: string;
  user_id: string | null;
  started_at: number;
  finished_at: number | null;
  status: string;
  error: string | null;
}

export interface InsertCronRunParams {
  taskId: string;
  userId: string | null;
  startedAt: number;
}

export class CronRunsRepo {
  private readonly stmtInsert;
  private readonly stmtLastId;
  private readonly stmtFinish;
  private readonly stmtListByTask;
  private readonly stmtListByUser;
  private readonly stmtPrune;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtInsert = db.prepare(
      "INSERT INTO cron_runs (task_id, user_id, started_at, status) VALUES (?, ?, ?, 'running')",
    );
    this.stmtLastId = db.prepare("SELECT last_insert_rowid() as id");
    this.stmtFinish = db.prepare(
      "UPDATE cron_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?",
    );
    this.stmtListByTask = db.prepare(
      "SELECT * FROM cron_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
    );
    this.stmtListByUser = db.prepare(
      "SELECT * FROM cron_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
    );
    this.stmtPrune = db.prepare(
      "DELETE FROM cron_runs WHERE started_at < ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  /**
   * Insert a "running" row, returns the new id.
   *
   * NOTE: bun:sqlite is single-connection synchronous, so `last_insert_rowid()`
   * returning the row inserted just above is safe. When migrating to Postgres
   * in Phase 1, swap to `INSERT ... RETURNING id` to keep this guarantee under
   * a connection pool.
   */
  insertRunning(p: InsertCronRunParams): number {
    this.stmtInsert.run(p.taskId, p.userId, p.startedAt);
    return Number((this.stmtLastId.get() as { id: number }).id);
  }

  finish(id: number, finishedAt: number, status: string, error: string | null): void {
    this.stmtFinish.run(finishedAt, status, error, id);
  }

  listByTask(taskId: string, limit: number = 50): readonly CronRunRow[] {
    return this.stmtListByTask.all(taskId, limit) as CronRunRow[];
  }

  listByUser(userId: string, limit: number = 50): readonly CronRunRow[] {
    return this.stmtListByUser.all(userId, limit) as CronRunRow[];
  }

  /** Delete runs older than `beforeTs`. Returns affected count. */
  pruneBefore(beforeTs: number): number {
    this.stmtPrune.run(beforeTs);
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
