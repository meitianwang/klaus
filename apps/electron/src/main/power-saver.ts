/**
 * Thin wrapper around Electron's powerSaveBlocker for the "keep system awake"
 * toggle on the Scheduled Tasks page. When enabled, macOS / Windows / Linux
 * won't put the app to sleep (app-suspension) during idle, so scheduled
 * cron jobs keep firing.
 *
 * We deliberately use 'prevent-app-suspension' instead of 'prevent-display-sleep' —
 * we don't need to keep the monitor on, just prevent the process from being
 * throttled while the user is away from the machine.
 */

import { powerSaveBlocker } from 'electron'

let blockerId: number | null = null

export function isPowerSaveBlockerActive(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}

export function startPowerSaveBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return
  blockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log('[PowerSaver] keep-awake started (id=' + blockerId + ')')
}

export function stopPowerSaveBlocker(): void {
  if (blockerId === null) return
  try {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
  } catch { /* already stopped */ }
  blockerId = null
  console.log('[PowerSaver] keep-awake stopped')
}
