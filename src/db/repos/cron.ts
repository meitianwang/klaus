/**
 * CronRepo — pure data-access layer for the `cron_tasks` table.
 *
 * Note: `user_id` was added in a v0.x migration. NULL means a legacy global
 * task (admin-only, pre-multi-user). New rows always carry user_id.
 *
 * Business rules (schedule serialization, deliver/failureAlert JSON marshalling,
 * task domain mapping) live in the calling service (SettingsStore).
 */

import { Database } from "bun:sqlite";

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
  schedule: string; // serialized
  prompt: string;
  enabled: number;
  thinking: string | null;
  lightContext: number;
  timeoutSeconds: number | null;
  deleteAfterRun: number;
  deliver: string | null; // serialized JSON
  webhookUrl: string | null;
  webhookToken: string | null;
  failureAlert: string | null; // serialized JSON
  createdAt: number;
  updatedAt: number;
}

export class CronRepo {
  private readonly stmtListAll;
  private readonly stmtGetById;
  private readonly stmtUpsert;
  private readonly stmtDelete;
  private readonly stmtListByUser;
  private readonly stmtDeleteByUser;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtListAll = db.prepare(
      "SELECT * FROM cron_tasks ORDER BY created_at ASC",
    );
    this.stmtGetById = db.prepare("SELECT * FROM cron_tasks WHERE id = ?");
    this.stmtUpsert = db.prepare(
      `INSERT INTO cron_tasks (id, user_id, name, description, schedule, prompt, enabled, thinking, light_context, timeout_seconds, delete_after_run, deliver, webhook_url, webhook_token, failure_alert, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         name = excluded.name, description = excluded.description,
         schedule = excluded.schedule, prompt = excluded.prompt,
         enabled = excluded.enabled, thinking = excluded.thinking,
         light_context = excluded.light_context, timeout_seconds = excluded.timeout_seconds,
         delete_after_run = excluded.delete_after_run, deliver = excluded.deliver,
         webhook_url = excluded.webhook_url, webhook_token = excluded.webhook_token,
         failure_alert = excluded.failure_alert, updated_at = excluded.updated_at`,
    );
    this.stmtDelete = db.prepare("DELETE FROM cron_tasks WHERE id = ?");
    this.stmtListByUser = db.prepare(
      "SELECT * FROM cron_tasks WHERE user_id = ? ORDER BY created_at ASC",
    );
    this.stmtDeleteByUser = db.prepare(
      "DELETE FROM cron_tasks WHERE id = ? AND user_id = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  list(): readonly CronTaskRow[] {
    return this.stmtListAll.all() as CronTaskRow[];
  }

  findById(id: string): CronTaskRow | undefined {
    return this.stmtGetById.get(id) as CronTaskRow | undefined;
  }

  listByUser(userId: string): readonly CronTaskRow[] {
    return this.stmtListByUser.all(userId) as CronTaskRow[];
  }

  upsert(p: UpsertCronTaskParams): void {
    this.stmtUpsert.run(
      p.id,
      p.userId,
      p.name,
      p.description,
      p.schedule,
      p.prompt,
      p.enabled,
      p.thinking,
      p.lightContext,
      p.timeoutSeconds,
      p.deleteAfterRun,
      p.deliver,
      p.webhookUrl,
      p.webhookToken,
      p.failureAlert,
      p.createdAt,
      p.updatedAt,
    );
  }

  delete(id: string): boolean {
    this.stmtDelete.run(id);
    return this.lastChanges() > 0;
  }

  deleteUserTask(userId: string, taskId: string): boolean {
    this.stmtDeleteByUser.run(taskId, userId);
    return this.lastChanges() > 0;
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
