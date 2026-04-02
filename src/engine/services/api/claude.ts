/**
 * Anthropic API streaming layer — adapted from claude-code's services/api/claude.ts.
 * Stripped: Bedrock/Vertex/Foundry, VCR, advisor, tool search, analytics, GrowthBook.
 * Preserved: streaming, thinking, tool_use parsing, usage tracking, error handling.
 */

import Anthropic from '@anthropic-ai/sdk'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID, type UUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import type { Tool, Tools, ToolInputJSONSchema, ThinkingConfig, ToolPermissionContext } from '../../Tool.js'
import type { QuerySource } from '../../constants/querySource.js'
import { createAnthropicClient, type GetClientOptions } from './client.js'
import { getModelMaxOutputTokens, CAPPED_DEFAULT_MAX_TOKENS, ESCALATED_MAX_TOKENS } from '../../utils/context.js'

// ============================================================================
// Constants
// ============================================================================

export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'prompt is too long'
const NO_CONTENT_MESSAGE = '(no content)'
const SYNTHETIC_MODEL = '<synthetic>'

// ============================================================================
// Options
// ============================================================================

export type Options = {
  model: string
  apiKey: string
  baseURL?: string
  maxOutputTokensOverride?: number
  querySource: QuerySource
  maxContextTokens?: number
}

// ============================================================================
// Message Normalization
// ============================================================================

function userMessageToParam(msg: Message): BetaMessageParam | null {
  if (msg.type !== 'user') return null
  const content = msg.message.content
  return {
    role: 'user' as const,
    content: typeof content === 'string'
      ? content || NO_CONTENT_MESSAGE
      : (content as ContentBlockParam[]),
  }
}

function assistantMessageToParam(msg: Message): BetaMessageParam | null {
  if (msg.type !== 'assistant') return null
  return {
    role: 'assistant' as const,
    content: msg.message.content.filter(
      (block: BetaContentBlock) => {
        // Filter out server-side blocks that can't be sent back
        const t = block.type as string
        return t !== 'server_tool_use' && t !== 'web_search_tool_result' && t !== 'mcp_tool_use' && t !== 'mcp_tool_result' && t !== 'container_operation'
      }
    ) as BetaContentBlock[],
  }
}

export function normalizeMessagesForAPI(
  messages: readonly Message[],
): BetaMessageParam[] {
  const result: BetaMessageParam[] = []
  for (const msg of messages) {
    if (msg.type === 'user') {
      const param = userMessageToParam(msg)
      if (param) result.push(param)
    } else if (msg.type === 'assistant') {
      const param = assistantMessageToParam(msg)
      if (param) result.push(param)
    }
    // Skip system, progress, attachment, hook_result, queue_operation messages
  }
  return result
}

// ============================================================================
// Tool Schema Conversion
// ============================================================================

export function toolToAPISchema(tool: Tool): BetaToolUnion {
  const schema = tool.inputJSONSchema ?? { type: 'object' as const }
  return {
    name: tool.name,
    description: '',
    input_schema: schema as any,
  }
}

// Simpler sync version that uses inputJSONSchema directly
export function toolToAPISchemaSync(tool: Tool): BetaToolUnion {
  const schema = tool.inputJSONSchema ?? { type: 'object' as const }
  return {
    name: tool.name,
    description: '',
    input_schema: schema as any,
  }
}

// ============================================================================
// Build tool schemas with descriptions
// ============================================================================

export async function buildToolSchemas(
  tools: Tools,
  options: {
    toolPermissionContext: ToolPermissionContext
    isNonInteractiveSession: boolean
    agents?: { agentType: string; name: string; description?: string }[]
  },
): Promise<BetaToolUnion[]> {
  const schemas: BetaToolUnion[] = []
  for (const tool of tools) {
    if (!tool.isEnabled()) continue
    const schema = tool.inputJSONSchema ?? { type: 'object' as const }
    const description = await tool.prompt({
      getToolPermissionContext: async () => options.toolPermissionContext,
      tools,
      agents: (options.agents ?? []) as any,
    })
    schemas.push({
      name: tool.name,
      description,
      input_schema: schema as any,
    })
  }
  return schemas
}

// ============================================================================
// System Prompt
// ============================================================================

export function buildSystemPromptBlocks(
  systemPrompt: SystemPrompt,
  enablePromptCaching = true,
): TextBlockParam[] {
  if (!systemPrompt || systemPrompt.length === 0) return []

  const { splitSysPromptPrefix } = require('../../utils/api.js') as typeof import('../../utils/api.js')
  const blocks = splitSysPromptPrefix(systemPrompt)

  return blocks.map((block) => ({
    type: 'text' as const,
    text: block.text,
    ...(enablePromptCaching && block.cacheScope !== null
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}),
  }))
}

// ============================================================================
// Max Output Tokens
// ============================================================================

export function getMaxOutputTokensForModel(
  model: string,
  override?: number,
): number {
  if (override) return override
  return CAPPED_DEFAULT_MAX_TOKENS
}

// ============================================================================
// Usage Tracking
// ============================================================================

export function updateUsage(
  existingUsage: Usage,
  newUsage: Usage,
): Usage {
  return {
    input_tokens: newUsage.input_tokens,
    output_tokens: existingUsage.output_tokens + newUsage.output_tokens,
    cache_creation_input_tokens:
      (existingUsage.cache_creation_input_tokens ?? 0) +
      (newUsage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (existingUsage.cache_read_input_tokens ?? 0) +
      (newUsage.cache_read_input_tokens ?? 0),
    server_tool_use: newUsage.server_tool_use ?? existingUsage.server_tool_use,
    service_tier: newUsage.service_tier ?? existingUsage.service_tier,
  } as Usage
}

export function accumulateUsage(
  existingUsage: Usage,
  newUsage: Usage,
): Usage {
  return {
    input_tokens: existingUsage.input_tokens + newUsage.input_tokens,
    output_tokens: existingUsage.output_tokens + newUsage.output_tokens,
    cache_creation_input_tokens:
      (existingUsage.cache_creation_input_tokens ?? 0) +
      (newUsage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (existingUsage.cache_read_input_tokens ?? 0) +
      (newUsage.cache_read_input_tokens ?? 0),
    server_tool_use: newUsage.server_tool_use ?? existingUsage.server_tool_use,
    service_tier: newUsage.service_tier ?? existingUsage.service_tier,
  } as Usage
}

// ============================================================================
// Error Helpers
// ============================================================================

function getAssistantMessageFromError(
  error: Error,
  model: string,
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      container: null,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      } as Usage,
      content: [{ type: 'text', text: error.message }],
      context_management: null,
    } as BetaMessage,
    isApiErrorMessage: true,
    errorDetails: error.message,
  }
}

// ============================================================================
// Core Streaming Function
// ============================================================================

export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  toolSchemas,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  toolSchemas: BetaToolUnion[]
  signal: AbortSignal
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  const client = createAnthropicClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })

  const normalizedMessages = normalizeMessagesForAPI(messages)
  if (normalizedMessages.length === 0) {
    normalizedMessages.push({ role: 'user', content: NO_CONTENT_MESSAGE })
  }

  // Ensure messages alternate user/assistant
  const fixedMessages = ensureAlternatingRoles(normalizedMessages)

  const maxOutputTokens = getMaxOutputTokensForModel(
    options.model,
    options.maxOutputTokensOverride,
  )

  const systemBlocks = buildSystemPromptBlocks(systemPrompt)

  const requestParams: Record<string, unknown> = {
    model: options.model,
    max_tokens: maxOutputTokens,
    messages: fixedMessages,
    system: systemBlocks,
    stream: true,
    ...(toolSchemas.length > 0 ? { tools: toolSchemas } : {}),
    ...(thinkingConfig.type === 'enabled'
      ? {
          thinking: {
            type: 'enabled',
            budget_tokens: thinkingConfig.budgetTokens,
          },
        }
      : {}),
  }

  yield { type: 'stream_request_start' } as StreamEvent

  try {
    const stream = client.beta.messages.stream(requestParams as any, {
      signal,
    })

    const contentBlocks: BetaContentBlock[] = []
    let usage: Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as Usage
    let stopReason: string | null = null
    let messageId = ''
    let model = options.model

    for await (const event of stream) {
      if (event.type === 'message_start') {
        const msg = event.message
        messageId = msg.id
        model = msg.model
        usage = msg.usage as Usage
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason
        if (event.usage) {
          usage = updateUsage(usage, event.usage as Usage)
        }
      } else if (event.type === 'content_block_start') {
        const block = event.content_block
        contentBlocks.push(block as BetaContentBlock)
      } else if (event.type === 'content_block_delta') {
        const idx = event.index
        const delta = event.delta
        if (idx < contentBlocks.length) {
          const block = contentBlocks[idx]!
          if (delta.type === 'text_delta' && block.type === 'text') {
            ;(block as any).text += delta.text
          } else if (delta.type === 'thinking_delta' && block.type === 'thinking') {
            ;(block as any).thinking += delta.thinking
          } else if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
            // Accumulate partial JSON
            if (!(block as any)._partialInput) {
              ;(block as any)._partialInput = ''
            }
            ;(block as any)._partialInput += delta.partial_json
          }
        }
      } else if (event.type === 'content_block_stop') {
        const idx = event.index
        if (idx < contentBlocks.length) {
          const block = contentBlocks[idx]!
          // Parse accumulated JSON for tool_use blocks
          if (block.type === 'tool_use' && (block as any)._partialInput) {
            try {
              ;(block as any).input = JSON.parse((block as any)._partialInput)
            } catch {
              ;(block as any).input = {}
            }
            delete (block as any)._partialInput
          }
        }
      }
    }

    // Build the final assistant message
    const assistantMessage: AssistantMessage = {
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        id: messageId,
        container: null,
        model,
        role: 'assistant',
        stop_reason: stopReason ?? 'end_turn',
        stop_sequence: null,
        type: 'message',
        usage,
        content: contentBlocks,
        context_management: null,
      } as BetaMessage,
    }

    yield assistantMessage
  } catch (error) {
    if (error instanceof APIUserAbortError) {
      throw error
    }

    // Check for prompt-too-long
    if (
      error instanceof Anthropic.APIError &&
      (error.message?.includes(PROMPT_TOO_LONG_ERROR_MESSAGE) ||
        error.status === 413)
    ) {
      yield getAssistantMessageFromError(
        new Error(PROMPT_TOO_LONG_ERROR_MESSAGE),
        options.model,
      )
      return
    }

    // Check for overloaded
    if (error instanceof Anthropic.APIError && error.status === 529) {
      yield getAssistantMessageFromError(
        new Error('API is overloaded. Please try again.'),
        options.model,
      )
      return
    }

    // Generic error
    const msg = error instanceof Error ? error.message : String(error)
    yield getAssistantMessageFromError(new Error(msg), options.model)
  }
}

// ============================================================================
// Ensure alternating roles
// ============================================================================

function ensureAlternatingRoles(
  messages: BetaMessageParam[],
): BetaMessageParam[] {
  if (messages.length === 0) return messages

  const result: BetaMessageParam[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // Merge same-role messages
      if (msg.role === 'user') {
        const lastContent = Array.isArray(last.content)
          ? last.content
          : [{ type: 'text' as const, text: last.content as string }]
        const newContent = Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text' as const, text: msg.content as string }]
        last.content = [...lastContent, ...newContent] as any
      } else {
        // For assistant, merge content arrays
        const lastContent = Array.isArray(last.content) ? last.content : []
        const newContent = Array.isArray(msg.content) ? msg.content : []
        last.content = [...lastContent, ...newContent] as any
      }
    } else {
      result.push({ ...msg })
    }
  }

  // Ensure first message is user
  if (result[0]?.role !== 'user') {
    result.unshift({ role: 'user', content: NO_CONTENT_MESSAGE })
  }

  return result
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupStream(stream: AsyncIterable<unknown>): void {
  // Consume remaining events to prevent resource leaks
  const iterator = stream[Symbol.asyncIterator]()
  const drain = async () => {
    try {
      while (!(await iterator.next()).done) {
        // drain
      }
    } catch {
      // ignore errors during cleanup
    }
  }
  drain()
}
