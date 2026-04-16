import type { ToolPermissionContext, Tool as ToolType, ToolUseContext } from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import type { PermissionDecision } from '../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../utils/permissions/PermissionUpdateSchema.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'

export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> = (
  tool: ToolType,
  input: Input,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: PermissionDecision<Input>,
) => Promise<PermissionDecision<Input>>

/**
 * Callback invoked when the engine decides 'ask' — bridges to the UI
 * (WebSocket in Klaus, terminal in claude-code).
 *
 * Returns the user's decision including optional updatedInput and
 * suggestions they chose to persist (e.g. "Always Allow").
 */
export type OnAskCallback = (params: {
  tool: ToolType
  input: Record<string, unknown>
  message: string
  suggestions?: PermissionUpdate[]
  toolUseContext: ToolUseContext
}) => Promise<{
  decision: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  /** Suggestions the user accepted (e.g. Always Allow rules to persist). */
  acceptedSuggestions?: PermissionUpdate[]
}>

/**
 * Non-React implementation of canUseTool that delegates to hasPermissionsToUseTool.
 * In the original claude-code, this was a React hook wrapping permission logic.
 * For Klaus (non-React), we expose a factory that returns a CanUseToolFn.
 *
 * @param onAsk  Optional callback for interactive approval (WebSocket bridge).
 *               When provided, 'ask' decisions are forwarded to the callback
 *               instead of being auto-denied.
 */
export function createCanUseTool(onAsk?: OnAskCallback): CanUseToolFn {
  return async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
    if (forceDecision !== undefined) {
      return forceDecision
    }
    const result = await hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID)
    if (result.behavior === 'allow') {
      return {
        behavior: 'allow' as const,
        updatedInput: result.updatedInput ?? input,
        decisionReason: result.decisionReason,
      }
    }

    // For 'ask' decisions with an interactive callback, forward to the UI
    if (result.behavior === 'ask' && onAsk) {
      const response = await onAsk({
        tool,
        input: input as Record<string, unknown>,
        message: result.message,
        suggestions: result.suggestions,
        toolUseContext,
      })

      if (response.decision === 'allow') {
        return {
          behavior: 'allow' as const,
          updatedInput: response.updatedInput ?? result.updatedInput ?? input,
          decisionReason: result.decisionReason,
        }
      }

      return {
        behavior: 'deny' as const,
        message: 'User denied permission',
        decisionReason: { type: 'other' as const, reason: 'user_rejected' },
      }
    }

    // Non-interactive: 'ask' → deny, or forward 'deny' as-is
    return result
  }
}

/**
 * Stub: useCanUseTool is a React hook. Use createCanUseTool() instead.
 */
export default function useCanUseTool(..._args: unknown[]): CanUseToolFn {
  throw new Error('useCanUseTool is a React hook and cannot be used in non-React context. Use createCanUseTool() instead.')
}
