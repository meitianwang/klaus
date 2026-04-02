/**
 * Simplified debug module for Klaus — adapted from claude-code's utils/debug.ts.
 * Removes file-based debug logging, symlinks, buffered writers.
 * Uses console.error for debug output.
 */

import { isEnvTruthy } from './envUtils.js'

export type DebugLogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<DebugLogLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

let minLevel: DebugLogLevel | null = null
function getMinDebugLogLevel(): DebugLogLevel {
  if (minLevel) return minLevel
  const raw = process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL?.toLowerCase().trim()
  if (raw && Object.hasOwn(LEVEL_ORDER, raw)) {
    minLevel = raw as DebugLogLevel
    return minLevel
  }
  minLevel = 'debug'
  return minLevel
}

let runtimeDebugEnabled = false

export function isDebugMode(): boolean {
  return (
    runtimeDebugEnabled ||
    isEnvTruthy(process.env.DEBUG) ||
    isEnvTruthy(process.env.DEBUG_SDK) ||
    process.argv.includes('--debug') ||
    process.argv.includes('-d')
  )
}

export function enableDebugLogging(): boolean {
  const wasActive = isDebugMode()
  runtimeDebugEnabled = true
  return wasActive
}

export function logForDebugging(
  message: string,
  { level }: { level: DebugLogLevel } = { level: 'debug' },
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[getMinDebugLogLevel()]) {
    return
  }
  if (!isDebugMode()) {
    return
  }
  const timestamp = new Date().toISOString()
  const output = `${timestamp} [${level.toUpperCase()}] ${message.trim()}`
  // eslint-disable-next-line no-console
  console.error(output)
}

export async function flushDebugLogs(): Promise<void> {
  // No-op in simplified version
}

export function logAntError(_context: string, _error: unknown): void {
  // No-op — ant-only feature not needed in Klaus
}
