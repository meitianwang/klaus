import type { SettingsStore } from './settings-store.js'
import type { EngineHost } from './engine-host.js'
import type { CronTask, CronRunTrigger } from '../shared/types.js'
import { getMainWindow } from './window.js'

/** Minimal structural type — main/index.ts injects ChannelManager after channels boot. */
interface ChannelDeliverer {
  deliverToBinding(
    binding: { channelId: string; accountId?: string; targetId: string; chatType: 'direct' | 'group'; threadId?: string },
    text: string,
  ): Promise<boolean>
}

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
  // Late-bound — wired in from main/index.ts after channels boot. Null while
  // channels are still starting; IM-bound tasks that fire during that window
  // get their delivery silently dropped (logged). Accepts the trade-off:
  // channels take ~2s to come up and cron tasks don't fire on :00:00 exactly.
  private channelDeliverer: ChannelDeliverer | null = null

  constructor(store: SettingsStore, engine: EngineHost) {
    this.store = store
    this.engine = engine
  }

  setChannelDeliverer(deliverer: ChannelDeliverer): void {
    this.channelDeliverer = deliverer
  }

  // --- Bridge surface used by the engine's CronCreate/Delete tools ---
  //
  // These are thin passthroughs that give the engine a "scheduler" interface
  // it can call without knowing Klaus's store layout. The heavy lifting
  // (persistence, run records, interrupt on cascade) stays in the SettingsStore
  // + existing execute() path — the scheduler's own polling tick picks the
  // task up on the next 60s cycle, so we don't need to do anything further
  // here beyond persist.
  addTask(task: CronTask): void { this.store.upsertTask(task) }
  editTask(id: string, patch: Partial<CronTask>): boolean {
    const current = this.store.getTask(id)
    if (!current) return false
    this.store.upsertTask({ ...current, ...patch, id, updatedAt: Date.now() })
    return true
  }
  removeTask(id: string): boolean {
    // Fire-and-forget the cascade so callers (engine tool) aren't forced
    // to await. UI already awaits via the IPC path.
    void this.deleteTaskCascade(id)
    return true
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

  /**
   * Fire a task right now regardless of schedule. Returns the sessionId of
   * the freshly-minted run so the UI can open that chat thread and watch it
   * stream. Returns null when the task is missing or already running.
   */
  runNow(taskId: string): { sessionId: string } | null {
    const task = this.store.getTask(taskId)
    if (!task) return null
    if (this.running.get(task.id)) return null
    const { sessionId } = this.execute(task, 'manual')
    return { sessionId }
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

  /**
   * Kicks off a task run synchronously — mints the sessionId + run row,
   * registers `running` state, then launches the async chat in the
   * background. Caller (tick or runNow) gets the sessionId immediately so
   * the UI can open the session and start rendering stream events as they
   * arrive. The returned `done` promise resolves in the finally block.
   */
  private execute(task: CronTask, trigger: CronRunTrigger): { sessionId: string; done: Promise<void> } {
    const startedAt = Date.now()
    // Each run gets its own sessionId so the sidebar can show every
    // execution as an independent chat thread. Engine creates the session
    // lazily on first chat() call.
    const { id: runId, sessionId } = this.store.createCronRun(task.id, task.name ?? task.id, trigger)
    let resolveDone!: () => void
    const done = new Promise<void>(r => { resolveDone = r })
    this.running.set(task.id, { sessionId, done })
    console.log(`[CronScheduler] Executing task: ${task.id} (${trigger}, run=${runId}, session=${sessionId})`)

    const loop = async () => {
      let finalText: string | null = null
      try {
        // engine.chat returns the assistant's final text for the last turn.
        // We capture it here (instead of scraping from stream events) so IM
        // delivery sees the same text the engine persists to JSONL.
        finalText = await this.engine.chat(sessionId, task.prompt, undefined, {
          // Forward engine events to the renderer just like chat:send does,
          // so the sidebar + open chat view of this cron-run session animate
          // live (text_delta, tool_use, done, etc.). Without this, cron
          // sessions sit silent until done.
          onEvent: (event) => {
            getMainWindow()?.webContents.send('chat:event', event)
          },
          // Forward permission asks the same way chat:send does. Without
          // this, any tool that needs user approval (Bash, AskUserQuestion,
          // …) would hang inside engine.onAsk waiting for a resolve that
          // never comes — and since the global chatQueue serializes every
          // engine.chat() call (CC's STATE.sessionId is module-global), a
          // single stuck cron run blocks every subsequent UI chat too.
          // The renderer routes the card by req.sessionId: if the user is
          // viewing this cron-run session it shows inline; otherwise it's
          // stashed in that session's sessionDom fragment so it appears
          // when the user clicks into the run from the sidebar.
          onPermissionRequest: (req) => {
            getMainWindow()?.webContents.send('permission:request', req)
          },
          // Don't emit user_message — the renderer seeds the user bubble
          // synthetically from task.prompt when switchSession opens a cron
          // run whose JSONL is still empty (engine boot takes ~100-500ms,
          // the synthetic seed shows instantly). Emitting here would race
          // against the seed and produce a duplicate bubble.
        })
        this.store.finishCronRun(runId, 'success', Date.now() - startedAt)
        // IM delivery: only on success, only when bound, only once per run.
        // Final text only — we intentionally don't stream text_delta to IM,
        // since IM surfaces have no streaming UI and would pile up chunks.
        if (task.channelBinding && finalText && finalText.trim()) {
          void this.deliverToBoundChannel(task, finalText).catch(err => {
            console.warn(`[CronScheduler] IM delivery for ${task.id} failed:`, err)
          })
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[CronScheduler] Task ${task.id} failed:`, err)
        this.store.finishCronRun(runId, 'failed', Date.now() - startedAt, errMsg)
        // Match success path: if bound, tell the user in the same IM channel
        // that the task failed. Otherwise a silent IM-bound task that fails
        // looks exactly like a healthy one that just had nothing to say.
        if (task.channelBinding) {
          const taskLabel = task.name || task.id
          const failText = `定时任务「${taskLabel}」运行失败：${errMsg.split('\n')[0]}`
          void this.deliverToBoundChannel(task, failText).catch(deliverErr => {
            console.warn(`[CronScheduler] failure-notice delivery for ${task.id} failed:`, deliverErr)
          })
        }
      } finally {
        this.running.delete(task.id)
        // One-shot tasks: flip to disabled instead of deleting. The old
        // behavior was to deleteTask() here which cascade-swept cron_runs
        // and the session JSONL — that meant the user never got to see
        // what Klaus actually did for a one-shot, since by the time they
        // opened the sidebar the whole thing was gone. Disabling keeps
        // the card (toggle off), the run row, and the session's
        // streaming history; tick() already filters on enabled so it
        // won't re-fire. User manually deletes when they're done.
        if (task.deleteAfterRun) {
          try {
            const current = this.store.getTask(task.id)
            if (current) this.store.upsertTask({ ...current, enabled: false, updatedAt: Date.now() })
          } catch (e) {
            console.error(`[CronScheduler] Failed to disable one-shot task ${task.id}:`, e)
          }
        }
        resolveDone()
      }
    }
    void loop()
    return { sessionId, done }
  }

  private async deliverToBoundChannel(task: CronTask, text: string): Promise<void> {
    const binding = task.channelBinding
    if (!binding) return
    const tag = `${binding.channelId}:${binding.targetId}`
    if (!this.channelDeliverer) {
      console.warn(`[CronScheduler] ${task.id} → ${tag}: channel manager not wired yet, dropping delivery`)
      return
    }
    console.log(`[CronScheduler] ${task.id} → ${tag}: delivering ${text.length} chars`)
    const ok = await this.channelDeliverer.deliverToBinding(binding, text)
    if (ok) {
      console.log(`[CronScheduler] ${task.id} → ${tag}: delivered OK`)
    } else {
      console.warn(`[CronScheduler] ${task.id} → ${tag}: delivery returned failure (see earlier [ChannelManager] log for the root cause)`)
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
