/**
 * CronRepoPg — PG implementation of cron_tasks repo (RLS-protected).
 */

import { and, eq, asc } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { cronTasks } from "../schema.js";

export interface CronTaskRow {
  id: string;
  user_id: string | null;
  name: string | null;
  description: string | null;
  schedule: string;
  prompt: string;
  enabled: number;
  thinking: string | null;
  light_context: number;
  timeout_seconds: number | null;
  delete_after_run: number;
  deliver: string | null;
  webhook_url: string | null;
  webhook_token: string | null;
  failure_alert: string | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertCronTaskParams {
  id: string;
  userId: string | null;
  name: string | null;
  description: string | null;
  schedule: string;
  prompt: string;
  enabled: number;
  thinking: string | null;
  lightContext: number;
  timeoutSeconds: number | null;
  deleteAfterRun: number;
  deliver: string | null;
  webhookUrl: string | null;
  webhookToken: string | null;
  failureAlert: string | null;
  createdAt: number;
  updatedAt: number;
}

function toRow(r: typeof cronTasks.$inferSelect): CronTaskRow {
  return {
    id: r.id,
    user_id: r.userId,
    name: r.name,
    description: r.description,
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled ? 1 : 0,
    thinking: r.thinking,
    light_context: r.lightContext ? 1 : 0,
    timeout_seconds: r.timeoutSeconds,
    delete_after_run: r.deleteAfterRun ? 1 : 0,
    // deliver / failureAlert are JSONB; SQLite caller expects serialized text.
    deliver: r.deliver == null ? null : JSON.stringify(r.deliver),
    webhook_url: r.webhookUrl,
    webhook_token: r.webhookToken,
    failure_alert:
      r.failureAlert == null ? null : JSON.stringify(r.failureAlert),
    created_at: r.createdAt.getTime(),
    updated_at: r.updatedAt.getTime(),
  };
}

export class CronRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async list(): Promise<readonly CronTaskRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(cronTasks)
      .orderBy(asc(cronTasks.createdAt));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<CronTaskRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(cronTasks)
      .where(eq(cronTasks.id, id))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async listByUser(userId: string): Promise<readonly CronTaskRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(cronTasks)
      .where(eq(cronTasks.userId, userId))
      .orderBy(asc(cronTasks.createdAt));
    return rows.map(toRow);
  }

  async upsert(p: UpsertCronTaskParams): Promise<void> {
    if (p.userId == null) {
      throw new Error(
        "[CronRepoPg.upsert] PG schema enforces NOT NULL user_id; legacy rows must be backfilled before insert",
      );
    }
    await this.dbOrTx
      .insert(cronTasks)
      .values({
        id: p.id,
        userId: p.userId,
        name: p.name,
        description: p.description,
        schedule: p.schedule,
        prompt: p.prompt,
        enabled: p.enabled === 1,
        thinking: p.thinking,
        lightContext: p.lightContext === 1,
        timeoutSeconds: p.timeoutSeconds,
        deleteAfterRun: p.deleteAfterRun === 1,
        deliver: p.deliver == null ? null : JSON.parse(p.deliver),
        webhookUrl: p.webhookUrl,
        webhookToken: p.webhookToken,
        failureAlert:
          p.failureAlert == null ? null : JSON.parse(p.failureAlert),
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      })
      .onConflictDoUpdate({
        target: cronTasks.id,
        set: {
          userId: p.userId,
          name: p.name,
          description: p.description,
          schedule: p.schedule,
          prompt: p.prompt,
          enabled: p.enabled === 1,
          thinking: p.thinking,
          lightContext: p.lightContext === 1,
          timeoutSeconds: p.timeoutSeconds,
          deleteAfterRun: p.deleteAfterRun === 1,
          deliver: p.deliver == null ? null : JSON.parse(p.deliver),
          webhookUrl: p.webhookUrl,
          webhookToken: p.webhookToken,
          failureAlert:
            p.failureAlert == null ? null : JSON.parse(p.failureAlert),
          updatedAt: new Date(p.updatedAt),
        },
      });
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(cronTasks)
      .where(eq(cronTasks.id, id))
      .returning({ id: cronTasks.id });
    return r.length > 0;
  }

  async deleteUserTask(userId: string, taskId: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(cronTasks)
      .where(and(eq(cronTasks.id, taskId), eq(cronTasks.userId, userId)))
      .returning({ id: cronTasks.id });
    return r.length > 0;
  }
}
