/**
 * Hook event types — adapted from claude-code's types/hooks.ts.
 * Stripped: zod schemas, lazySchema, agentSdkTypes, type-fest, commitAttribution.
 * Preserved: core hook types used by query loop and tool execution.
 */

import type { Message } from './message.js'
import type { PermissionBehavior, PermissionResult } from './permissions.js'

// ============================================================================
// Hook Events
// ============================================================================

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'SubagentStop',
  'UserPromptSubmit',
  'SessionStart',
  'Setup',
  'SubagentStart',
  'PermissionDenied',
  'PermissionRequest',
  'Elicitation',
  'ElicitationResult',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'TaskCompleted',
  'TeammateIdle',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

export function isHookEvent(value: string): value is HookEvent {
  return HOOK_EVENTS.includes(value as HookEvent)
}

// ============================================================================
// Hook Input/Output
// ============================================================================

export type HookInput = {
  type: HookEvent
  [key: string]: unknown
}

export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: Record<string, unknown>
}

export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}

export type HookJSONOutput = SyncHookJSONOutput | AsyncHookJSONOutput

export function isSyncHookJSONOutput(
  json: HookJSONOutput,
): json is SyncHookJSONOutput {
  return !('async' in json && json.async === true)
}

export function isAsyncHookJSONOutput(
  json: HookJSONOutput,
): json is AsyncHookJSONOutput {
  return 'async' in json && json.async === true
}

// ============================================================================
// Hook Callback
// ============================================================================

export type HookCallback = {
  type: 'callback'
  callback: (
    input: HookInput,
    toolUseID: string | null,
    abort: AbortSignal | undefined,
    hookIndex?: number,
    context?: HookCallbackContext,
  ) => Promise<HookJSONOutput>
  timeout?: number
  internal?: boolean
}

export type HookCallbackContext = {
  getAppState: () => unknown
  updateAttributionState: (updater: (prev: unknown) => unknown) => void
}

export type HookCallbackMatcher = {
  matcher?: string
  hooks: HookCallback[]
  pluginName?: string
}

// ============================================================================
// Hook Progress & Results
// ============================================================================

export type HookProgress = {
  type: 'hook_progress'
  hookEvent: HookEvent
  hookName: string
  command: string
  promptText?: string
  statusMessage?: string
}

export type HookBlockingError = {
  blockingError: string
  command: string
}

export type PermissionUpdate = {
  tool: string
  behavior: PermissionBehavior
  prefix?: string
}

export type PermissionRequestResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
    }
  | {
      behavior: 'deny'
      message?: string
      interrupt?: boolean
    }

export type HookResult = {
  message?: Message
  systemMessage?: Message
  blockingError?: HookBlockingError
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled'
  preventContinuation?: boolean
  stopReason?: string
  permissionBehavior?: PermissionBehavior | 'passthrough'
  hookPermissionDecisionReason?: string
  additionalContext?: string
  initialUserMessage?: string
  updatedInput?: Record<string, unknown>
  updatedMCPToolOutput?: unknown
  permissionRequestResult?: PermissionRequestResult
  retry?: boolean
}

export type AggregatedHookResult = {
  message?: Message
  blockingErrors?: HookBlockingError[]
  preventContinuation?: boolean
  stopReason?: string
  hookPermissionDecisionReason?: string
  permissionBehavior?: PermissionResult['behavior']
  additionalContexts?: string[]
  initialUserMessage?: string
  updatedInput?: Record<string, unknown>
  updatedMCPToolOutput?: unknown
  permissionRequestResult?: PermissionRequestResult
  retry?: boolean
}
