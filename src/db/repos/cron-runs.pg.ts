/**
 * CronRunsRepoPg — PG implementation. Each cron execution audit row.
 * Uses INSERT ... RETURNING id (replaces SQLite's last_insert_rowid trick).
 */

import { eq, lt, desc } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { cronRuns } from "../schema.js";

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

function toRow(r: typeof cronRuns.$inferSelect): CronRunRow {
  return {
    id: r.id,
    task_id: r.taskId,
    user_id: r.userId,
    started_at: r.startedAt.getTime(),
    finished_at: r.finishedAt?.getTime() ?? null,
    status: r.status,
    error: r.error,
  };
}

export class CronRunsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async insertRunning(p: InsertCronRunParams): Promise<number> {
    if (p.userId == null) {
      throw new Error(
        "[CronRunsRepoPg.insertRunning] PG schema enforces NOT NULL user_id",
      );
    }
    const r = await this.dbOrTx
      .insert(cronRuns)
      .values({
        taskId: p.taskId,
        userId: p.userId,
        startedAt: new Date(p.startedAt),
        status: "running",
      })
      .returning({ id: cronRuns.id });
    return r[0]!.id;
  }

  async finish(
    id: number,
    finishedAt: number,
    status: string,
    error: string | null,
  ): Promise<void> {
    await this.dbOrTx
      .update(cronRuns)
      .set({ finishedAt: new Date(finishedAt), status, error })
      .where(eq(cronRuns.id, id));
  }

  async listByTask(taskId: string, limit: number = 50): Promise<readonly CronRunRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.taskId, taskId))
      .orderBy(desc(cronRuns.startedAt))
      .limit(limit);
    return rows.map(toRow);
  }

  async listByUser(userId: string, limit: number = 50): Promise<readonly CronRunRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.userId, userId))
      .orderBy(desc(cronRuns.startedAt))
      .limit(limit);
    return rows.map(toRow);
  }

  async pruneBefore(beforeTs: number): Promise<number> {
    const r = await this.dbOrTx
      .delete(cronRuns)
      .where(lt(cronRuns.startedAt, new Date(beforeTs)))
      .returning({ id: cronRuns.id });
    return r.length;
  }
}
