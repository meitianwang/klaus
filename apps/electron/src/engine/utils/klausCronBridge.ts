/**
 * Bridge between Claude Code engine cron tools and Klaus's CronScheduler + SettingsStore.
 *
 * The engine tools (CronCreate/Delete/List) were originally designed for the CLI,
 * writing to .claude/scheduled_tasks.json. In Klaus's server context, tasks are
 * stored in SQLite and managed by Klaus's CronScheduler. This module provides
 * the glue so the engine tools operate on Klaus's system instead.
 */

import type { CronTask } from "../../types.js";

interface KlausCronStore {
  upsertTask(task: CronTask): void;
  listUserTasks(userId: string): CronTask[];
  deleteUserTask(userId: string, taskId: string): boolean;
  getBool(key: string, defaultValue: boolean): boolean;
}

interface KlausCronScheduler {
  addTask(task: CronTask): void;
  editTask(id: string, patch: Partial<CronTask>): boolean;
  removeTask(id: string): boolean;
}

let _store: KlausCronStore | null = null;
let _scheduler: KlausCronScheduler | null = null;

export function setKlausCronBridge(
  store: KlausCronStore,
  scheduler: KlausCronScheduler | null,
): void {
  _store = store;
  _scheduler = scheduler;
}

export function getKlausCronStore(): KlausCronStore | null {
  return _store;
}

export function getKlausCronScheduler(): KlausCronScheduler | null {
  return _scheduler;
}

export function isKlausCronAvailable(): boolean {
  return _store !== null;
}
