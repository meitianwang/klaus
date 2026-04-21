import type { SettingsStore } from './settings-store.js'
import type { EngineHost } from './engine-host.js'
import type { CronTask, CronRunTrigger } from '../shared/types.js'

/**
 * Simple cron scheduler for the Electron app.
 * Polls tasks from settings.db, executes them via EngineHost.chat(),
 * and records each run (scheduled or manual) into the cron_runs table.
 * Uses a dedicated session per task.
 */
export class CronScheduler {
  private store: SettingsStore
  private engine: EngineHost
  private timer: ReturnType<typeof setInterval> | null = null
  // taskId → { sessionId in flight, promise resolving when execute() finally
  // block has run }. Lets deleteTaskCascade both interrupt AND await the
  // run's cleanup before cascading — guarantees the cron_runs row the catch
  // block writes is swept in the same delete, no orphan state.
  private running = new Map<string, { sessionId: string; done: Promise<void> }>()

  constructor(store: SettingsStore, engine: EngineHost) {
    this.store = store
    this.engine = engine
  }

  start(): void {
    if (this.timer) return
    // Clean up any rows left in 'running' state from a previous crash
    try {
      const reaped = this.store.reapStaleCronRuns()
      if (reaped > 0) console.log(`[CronScheduler] Reaped ${reaped} stale run(s) from previous crash`)
    } catch {}
    // Check every 60 seconds
    this.timer = setInterval(() => this.tick(), 60_000)
    // Initial tick after 5s
    setTimeout(() => this.tick(), 5_000)
    console.log('[CronScheduler] Started')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[CronScheduler] Stopped')
  }

  /** Fire a task right now regardless of schedule. Returns false if already running. */
  async runNow(taskId: string): Promise<boolean> {
    const task = this.store.getTask(taskId)
    if (!task) return false
    if (this.running.get(task.id)) return false
    this.execute(task, 'manual')
    return true
  }

  private tick(): void {
    const tasks = this.store.listTasks().filter(t => t.enabled)
    const now = new Date()

    for (const task of tasks) {
      if (this.running.get(task.id)) continue
      if (this.shouldRun(task, now)) {
        this.execute(task, 'scheduled')
      }
    }
  }

  private shouldRun(task: CronTask, now: Date): boolean {
    // Simple cron matching — supports "M H D Mo DoW" (5 fields). When the task
    // carries a timezone, we read the clock parts from that zone instead of
    // the process's local time.
    try {
      const parts = task.schedule.trim().split(/\s+/)
      if (parts.length < 5) return false

      const [minute, hour, day, month, dow] = parts
      const p = task.timezone ? partsInZone(now, task.timezone) : localParts(now)
      if (!matchField(minute!, p.minute)) return false
      if (!matchField(hour!, p.hour)) return false
      if (!matchField(day!, p.day)) return false
      if (!matchField(month!, p.month)) return false
      if (!matchField(dow!, p.dow)) return false
      return true
    } catch {
      return false
    }
  }

  private async execute(task: CronTask, trigger: CronRunTrigger): Promise<void> {
    const startedAt = Date.now()
    // Each run gets its own sessionId (minted by the store) so the sidebar
    // can show every execution as an independent chat thread. The engine
    // creates the session lazily on first chat() call.
    const { id: runId, sessionId } = this.store.createCronRun(task.id, task.name ?? task.id, trigger)
    // Expose a "done" promise so deleteTaskCascade can await this finally
    // block (writes cron_runs row) before it cascades. Without the wait,
    // interrupt → cascade → catch block races and leaves an orphan row.
    let resolveDone!: () => void
    const done = new Promise<void>(r => { resolveDone = r })
    this.running.set(task.id, { sessionId, done })
    console.log(`[CronScheduler] Executing task: ${task.id} (${trigger}, run=${runId}, session=${sessionId})`)

    try {
      await this.engine.chat(sessionId, task.prompt)
      this.store.finishCronRun(runId, 'success', Date.now() - startedAt)
    } catch (err) {
      console.error(`[CronScheduler] Task ${task.id} failed:`, err)
      this.store.finishCronRun(
        runId,
        'failed',
        Date.now() - startedAt,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      this.running.delete(task.id)
      // One-shot tasks self-delete after their first run regardless of outcome.
      if (task.deleteAfterRun) {
        try { this.store.deleteTask(task.id) } catch (e) {
          console.error(`[CronScheduler] Failed to delete one-shot task ${task.id}:`, e)
        }
      }
      resolveDone()
    }
  }

  /**
   * User-initiated delete. Cleans up everything so no orphan state is left:
   *   1. Interrupts the in-flight chat() and awaits execute()'s finally so the
   *      failed-run row is written before we sweep.
   *   2. Cascade-deletes cron_tasks + cron_runs rows atomically.
   *   3. Asks the engine to drop each run's session (JSONL + registry entry).
   * Returns the number of sessions cleaned so the caller can report progress.
   */
  async deleteTaskCascade(taskId: string): Promise<{ deleted: boolean; sessionCount: number }> {
    const inflight = this.running.get(taskId)
    if (inflight) {
      try { this.engine.interrupt(inflight.sessionId) } catch (e) {
        console.warn(`[CronScheduler] interrupt failed for ${taskId}:`, e)
      }
      // Wait for execute()'s finally block so the aborted run row lands in
      // cron_runs before our cascade SELECT/DELETE runs. Capped at 5s so a
      // hung chat() can't block the UI forever — worst case a handful of
      // orphan rows remain, which reapStaleCronRuns cleans on next startup.
      await Promise.race([
        inflight.done,
        new Promise<void>(r => setTimeout(r, 5000)),
      ])
    }
    const { deleted, sessionIds } = this.store.deleteTaskCascade(taskId)
    for (const sid of sessionIds) {
      try { this.engine.deleteSession(sid) } catch (e) {
        console.warn(`[CronScheduler] deleteSession(${sid}) failed:`, e)
      }
    }
    return { deleted, sessionCount: sessionIds.length }
  }
}

function localParts(d: Date) {
  return {
    minute: d.getMinutes(),
    hour: d.getHours(),
    day: d.getDate(),
    month: d.getMonth() + 1,
    dow: d.getDay(),
  }
}

// Extract clock parts in the given IANA timezone (e.g. "Asia/Shanghai").
// Invalid tz falls back to local.
function partsInZone(d: Date, tz: string) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', weekday: 'short',
    })
    const parts: Record<string, string> = {}
    for (const p of fmt.formatToParts(d)) {
      if (p.type !== 'literal') parts[p.type] = p.value
    }
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    // hour12:false can return '24' for midnight in some locales — normalize.
    const h = parseInt(parts.hour ?? '0', 10)
    return {
      minute: parseInt(parts.minute ?? '0', 10),
      hour: h === 24 ? 0 : h,
      day: parseInt(parts.day ?? '1', 10),
      month: parseInt(parts.month ?? '1', 10),
      dow: dowMap[parts.weekday ?? 'Sun'] ?? 0,
    }
  } catch {
    return localParts(d)
  }
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true
  // Comma-separated values
  const parts = field.split(',')
  for (const p of parts) {
    // Range: 1-5
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number)
      if (value >= a! && value <= b!) return true
    }
    // Step: */5
    else if (p.startsWith('*/')) {
      const step = Number(p.slice(2))
      if (step > 0 && value % step === 0) return true
    }
    // Exact
    else if (Number(p) === value) return true
  }
  return false
}
