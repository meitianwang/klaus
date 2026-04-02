/**
 * Adapter: wraps Klaus legacy AgentTool (execute()) as an engine Tool (call()).
 * This allows legacy tools (memory, skills, moonshot, capabilities) to work
 * with the engine's query loop without rewriting each tool.
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../Tool.js'
import type { ToolUseContext, CanUseToolFn, ToolCallProgress, ToolProgressData } from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import type { PermissionResult } from '../types/permissions.js'

/** Legacy AgentTool interface (from klaus-agent-compat.ts) */
export interface LegacyAgentTool {
  name: string
  label: string
  description: string
  parameters: unknown
  execute(
    toolCallId: string,
    params: unknown,
    ctx: {
      signal: AbortSignal
      onUpdate: (...args: unknown[]) => void
      approval: { isYolo(): boolean; [key: string]: unknown }
      agentName: string
    },
  ): Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>
}

/**
 * Wrap a legacy AgentTool as an engine Tool.
 */
export function wrapLegacyTool(legacyTool: LegacyAgentTool) {
  // Create a permissive zod schema from the legacy parameters
  const inputSchema = z.object({}).passthrough()

  return buildTool({
    name: legacyTool.name,
    maxResultSizeChars: 100_000,

    inputSchema,
    inputJSONSchema: legacyTool.parameters as any,

    async call(
      args: Record<string, unknown>,
      context: ToolUseContext,
      _canUseTool: CanUseToolFn,
      _parentMessage: AssistantMessage,
      _onProgress?: ToolCallProgress,
    ) {
      const result = await legacyTool.execute(
        `legacy-${Date.now()}`,
        args,
        {
          signal: context.abortController.signal,
          onUpdate: () => {},
          approval: { isYolo: () => true },
          agentName: 'klaus',
        },
      )

      // Convert legacy result to engine format
      const textParts = result.content
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
      const text = textParts.join('\n') || '(no output)'

      return { data: text }
    },

    async description() {
      return legacyTool.description
    },

    async prompt() {
      return legacyTool.description
    },

    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isEnabled: () => true,
    userFacingName: () => legacyTool.label || legacyTool.name,
    toAutoClassifierInput: () => '',

    async checkPermissions(input: Record<string, unknown>) {
      return { behavior: 'allow' as const, updatedInput: input } as PermissionResult
    },

    mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: content,
      }
    },
  })
}

/**
 * Wrap an array of legacy tools as engine tools.
 */
export function wrapLegacyTools(tools: LegacyAgentTool[]) {
  return tools.map(wrapLegacyTool)
}
