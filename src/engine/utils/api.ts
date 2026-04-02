/**
 * Simplified API utilities for Klaus — adapted from claude-code's utils/api.ts.
 * Removes analytics, GrowthBook, tool search, plan mode, swarm features,
 * MCP prefetching, and most complex normalization.
 * Keeps: prependUserContext, appendSystemContext, splitSysPromptPrefix (simplified).
 */

import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Tool, Tools } from '../Tool.js'
import type { Message } from '../types/message.js'
import { createUserMessage } from './messages.js'
import type { SystemPrompt } from './systemPromptType.js'

export type CacheScope = 'global' | 'org'
export type SystemPromptBlock = {
  text: string
  cacheScope: CacheScope | null
}

/**
 * Convert a tool to its API schema representation.
 * Simplified: no strict mode, no feature gates, no swarm field filtering.
 */
export async function toolToAPISchema(
  tool: Tool,
  options: {
    getToolPermissionContext: () => Promise<unknown>
    tools: Tools
    agents?: unknown[]
    allowedAgentTypes?: string[]
    model?: string
    deferLoading?: boolean
    cacheControl?: {
      type: 'ephemeral'
      scope?: 'global' | 'org'
      ttl?: '5m' | '1h'
    }
  },
): Promise<BetaToolUnion> {
  // Use tool's JSON schema directly if provided, otherwise convert Zod schema
  let input_schema: Anthropic.Tool.InputSchema
  if ('inputJSONSchema' in tool && tool.inputJSONSchema) {
    input_schema = tool.inputJSONSchema as Anthropic.Tool.InputSchema
  } else {
    // Inline zodToJsonSchema: convert zod schema to JSON schema
    const convert = (_schema: unknown) => ({ type: 'object' as const, properties: {} })
    input_schema = convert(tool.inputSchema) as Anthropic.Tool.InputSchema
  }

  const schema: BetaTool & { defer_loading?: boolean } = {
    name: tool.name,
    description: await tool.prompt({
      getToolPermissionContext: options.getToolPermissionContext as any,
      tools: options.tools,
      agents: (options.agents ?? []) as any[],
      allowedAgentTypes: options.allowedAgentTypes,
    }),
    input_schema,
  }

  if (options.deferLoading) {
    schema.defer_loading = true
  }

  if (options.cacheControl) {
    schema.cache_control = options.cacheControl
  }

  return schema as BetaTool
}

/**
 * Prepend user context as a system-reminder message.
 */
export function prependUserContext(
  messages: Message[],
  context: { [k: string]: string },
): Message[] {
  if (process.env.NODE_ENV === 'test') {
    return messages
  }

  if (Object.entries(context).length === 0) {
    return messages
  }

  return [
    createUserMessage({
      content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${Object.entries(
        context,
      )
        .map(([key, value]) => `# ${key}\n${value}`)
        .join('\n')}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
      isMeta: true,
    }),
    ...messages,
  ]
}

/**
 * Append system context entries to the system prompt array.
 */
export function appendSystemContext(
  systemPrompt: SystemPrompt,
  context: { [k: string]: string },
): string[] {
  return [
    ...systemPrompt,
    Object.entries(context)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  ].filter(Boolean)
}

/**
 * Simplified system prompt prefix splitting.
 * Returns system prompt blocks with org-level caching.
 */
export function splitSysPromptPrefix(
  systemPrompt: SystemPrompt,
): SystemPromptBlock[] {
  const result: SystemPromptBlock[] = []
  for (const block of systemPrompt) {
    if (!block) continue
    result.push({ text: block, cacheScope: 'org' })
  }
  return result
}
