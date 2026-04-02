/**
 * Bootstrap state — simplified from claude-code's ~600-line global singleton.
 * Klaus uses an instantiable class instead of module-level globals.
 */

import { randomUUID } from 'crypto'
import type { SessionId } from '../types/ids.js'
import { asSessionId } from '../types/ids.js'

export class BootstrapState {
  readonly cwd: string
  readonly sessionId: SessionId
  readonly isNonInteractiveSession: boolean = true

  constructor(cwd: string) {
    this.cwd = cwd
    this.sessionId = asSessionId(randomUUID())
  }

  getSessionId(): SessionId {
    return this.sessionId
  }

  getIsNonInteractiveSession(): boolean {
    return this.isNonInteractiveSession
  }
}

// ============================================================================
// Module-level accessors (for compatibility with engine code that imports
// individual functions from bootstrap/state)
// ============================================================================

let _state: BootstrapState | undefined

export function initState(cwd: string): BootstrapState {
  _state = new BootstrapState(cwd)
  return _state
}

function requireState(): BootstrapState {
  if (!_state) {
    throw new Error('BootstrapState not initialized — call initState(cwd) first')
  }
  return _state
}

export function getSessionId(): SessionId {
  return requireState().getSessionId()
}

export function getOriginalCwd(): string {
  return requireState().cwd
}

export function getIsNonInteractiveSession(): boolean {
  return true
}
