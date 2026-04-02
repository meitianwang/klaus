/**
 * Minimal config utilities — stub for engine internal references.
 * Klaus has its own SettingsStore; this only provides directory paths
 * that other engine modules may reference.
 */

import { getClaudeConfigHomeDir } from './envUtils.js'

/**
 * Returns the Claude config directory (~/.claude by default).
 */
export function getConfigDir(): string {
  return getClaudeConfigHomeDir()
}

/**
 * Returns the current project directory.
 */
export function getProjectDir(): string {
  return process.cwd()
}
