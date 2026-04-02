/**
 * Compaction — adapted from claude-code's services/compact/compact.ts.
 * Stripped: hooks, file restoration, skill re-injection, analytics, session memory.
 * Preserved: core compaction algorithm, summary generation, boundary messages.
 */

import { randomUUID, type UUID } from 'crypto'
import type {
  BetaContentBlock,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  HookResultMessage,
  Message,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { normalizeMessagesForAPI, queryModelWithStreaming, type Options as ApiOptions } from '../api/claude.js'
import { getCompactPrompt, formatCompactSummary } from './prompt.js'

// ============================================================================
// Constants
// ============================================================================

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES = 'Not enough messages to compact.'
export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Please try again with fewer messages.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted — please try again.'

const PROMPT_TOO_LONG_ERROR = 'prompt is too long'

// ============================================================================
// Types
// ============================================================================

export interface CompactionResult {
  boundaryMarker: SystemMessage
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  hookResults: HookResultMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
}

export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: string
}

// ============================================================================
// Build post-compact messages
// ============================================================================

export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...(result.messagesToKeep ?? []),
    ...result.attachments,
    ...result.hookResults,
  ]
}

// ============================================================================
// Helper: create messages
// ============================================================================

function createUserMessage(params: {
  content: string
  isMeta?: true
  isCompactSummary?: true
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
  }
}): UserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: params.content,
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    isMeta: params.isMeta,
    isCompactSummary: params.isCompactSummary,
    summarizeMetadata: params.summarizeMetadata,
  } as UserMessage
}

function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      messagesSummarized,
    },
  } as SystemCompactBoundaryMessage
}

// ============================================================================
// Helper: extract text from assistant message
// ============================================================================

function getAssistantMessageText(msg: AssistantMessage): string | null {
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      return (block as { type: 'text'; text: string }).text
    }
  }
  return null
}

// ============================================================================
// Core: compactConversation
// ============================================================================

export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  suppressFollowUpQuestions: boolean = true,
  customInstructions?: string,
  isAutoCompact: boolean = false,
): Promise<CompactionResult> {
  if (messages.length === 0) {
    throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
  }

  const preCompactTokenCount = tokenCountWithEstimation(messages)

  context.onCompactProgress?.({ type: 'compact_start' })

  // Build compact prompt
  const compactPrompt = getCompactPrompt(customInstructions)
  const summaryRequest = createUserMessage({ content: compactPrompt })

  // Call the API to generate summary
  const messagesToSummarize = [...messages, summaryRequest]

  let summaryText: string | null = null

  // Stream the compact request
  const apiOptions: ApiOptions = {
    model: context.options.mainLoopModel,
    apiKey: '', // Will be set by the caller via toolUseContext
    querySource: 'compact',
  }

  // Use the same API call mechanism
  // In Klaus, the API key comes from the context's model config
  // We need to extract it from the toolUseContext
  const gen = queryModelWithStreaming({
    messages: messagesToSummarize,
    systemPrompt: '' as any,
    thinkingConfig: { type: 'disabled' },
    tools: [],
    toolSchemas: [],
    signal: context.abortController.signal,
    options: apiOptions,
  })

  let summaryResponse: AssistantMessage | undefined
  for await (const event of gen) {
    if (event.type === 'assistant') {
      summaryResponse = event as AssistantMessage
    }
  }

  if (!summaryResponse) {
    if (context.abortController.signal.aborted) {
      throw new Error(ERROR_MESSAGE_USER_ABORT)
    }
    throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  }

  summaryText = getAssistantMessageText(summaryResponse)

  if (!summaryText) {
    throw new Error('Failed to generate conversation summary')
  }

  if (summaryText.startsWith(PROMPT_TOO_LONG_ERROR)) {
    throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
  }

  // Format the summary (strip <analysis> block)
  const formattedSummary = formatCompactSummary(summaryText)

  // Clear file state cache
  context.readFileState.clear()
  context.loadedNestedMemoryPaths?.clear()

  // Build result
  const boundaryMarker = createCompactBoundaryMessage(
    isAutoCompact ? 'auto' : 'manual',
    preCompactTokenCount,
    messages.length,
  )

  const summaryMessage = createUserMessage({
    content: formattedSummary,
    isCompactSummary: true,
    summarizeMetadata: {
      messagesSummarized: messages.length,
    },
  })

  context.onCompactProgress?.({ type: 'compact_end' })

  console.log(
    `[Compact] ${isAutoCompact ? 'Auto' : 'Manual'} compaction: ${messages.length} messages → summary (${preCompactTokenCount} tokens pre-compact)`,
  )

  return {
    boundaryMarker,
    summaryMessages: [summaryMessage],
    attachments: [],
    hookResults: [],
    preCompactTokenCount,
  }
}
