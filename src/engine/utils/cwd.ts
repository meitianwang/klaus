import { AsyncLocalStorage } from 'async_hooks'
import { getOriginalCwd } from '../bootstrap/state.js'

const cwdOverrideStorage = new AsyncLocalStorage<string>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}

/**
 * Get the current working directory from the async-local override or bootstrap state.
 */
export function pwd(): string {
  return cwdOverrideStorage.getStore() ?? getOriginalCwd()
}

/**
 * Get the current working directory, falling back to process.cwd() if bootstrap
 * state is not yet initialized.
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return process.cwd()
  }
}
