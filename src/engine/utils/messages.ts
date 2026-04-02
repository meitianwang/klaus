/**
 * Simplified messages module for Klaus — adapted from claude-code's utils/messages.ts.
 * Removes analytics, GrowthBook, React/UI-specific rendering, plan mode, hook attachments.
 * Keeps: createUserMessage, createAssistantMessage, extractTextContent,
 *        normalizeMessages, getContentText, isNotEmptyMessage, deriveUUID, and related helpers.
 */

import type {
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID, type UUID } from 'crypto'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'
import type {
  AssistantMessage,
  Message,
  MessageOrigin,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  PartialCompactDirection,
  SDKAssistantMessageError,
  UserMessage,
} from '../types/message.js'
import type { PermissionMode } from '../types/permissions.js'

// Re-export for convenience
export type { Usage }

export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  'The user has interrupted the current operation. Please acknowledge and wait for further instructions.'
export const CANCEL_MESSAGE =
  'The user has cancelled the current request. Please stop what you were doing.'
export const REJECT_MESSAGE = 'The user rejected this tool call.'
export const REJECT_MESSAGE_WITH_REASON_PREFIX =
  'The user rejected this tool call with the following message:'
export const SUBAGENT_REJECT_MESSAGE =
  'The parent agent rejected this tool call.'
export const SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX =
  'The parent agent rejected this tool call with the following message:'
export const PLAN_REJECTION_PREFIX = "Here's the user's feedback:\n\n"
export const DENIAL_WORKAROUND_GUIDANCE = `You may suggest alternative approaches that might achieve a similar result within the security constraints.`
export const NO_RESPONSE_REQUESTED = 'No response requested.'
export const SYNTHETIC_MODEL = '<synthetic>'

export function AUTO_REJECT_MESSAGE(toolName: string): string {
  return `The user rejected this ${toolName} tool call. The user has an auto-reject rule in place that rejected this tool call. Please find an alternative approach that doesn't require this operation.`
}

export function DONT_ASK_REJECT_MESSAGE(toolName: string): string {
  return `The user rejected this ${toolName} tool call. Please find an alternative approach that doesn't require this operation.`
}

/**
 * Deterministic UUID derivation from parent UUID + index.
 */
export function deriveUUID(parentUUID: UUID, index: number): UUID {
  const hex = index.toString(16).padStart(12, '0')
  return `${parentUUID.slice(0, 24)}${hex}` as UUID
}

function baseCreateAssistantMessage({
  content,
  usage,
  isVirtual,
  isApiErrorMessage,
  apiError,
  error,
  errorDetails,
}: {
  content: BetaContentBlock[]
  usage?: Usage
  isVirtual?: true
  isApiErrorMessage?: boolean
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
}): AssistantMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      content,
      model: SYNTHETIC_MODEL,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: usage ?? { input_tokens: 0, output_tokens: 0 },
    } as BetaMessage,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    isVirtual,
    isApiErrorMessage,
    apiError,
    error,
    errorDetails,
  }
}

export function createAssistantMessage({
  content,
  usage,
  isVirtual,
}: {
  content: string | BetaContentBlock[]
  usage?: Usage
  isVirtual?: true
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content:
      typeof content === 'string'
        ? [
            {
              type: 'text' as const,
              text: content === '' ? NO_CONTENT_MESSAGE : content,
            } as BetaContentBlock,
          ]
        : content,
    usage,
    isVirtual,
  })
}

export function createAssistantAPIErrorMessage({
  content,
  apiError,
  error,
  errorDetails,
}: {
  content: string
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content: [
      {
        type: 'text' as const,
        text: content === '' ? NO_CONTENT_MESSAGE : content,
      } as BetaContentBlock,
    ],
    isApiErrorMessage: true,
    apiError,
    error,
    errorDetails,
  })
}

export function createUserMessage({
  content,
  isMeta,
  isVisibleInTranscriptOnly,
  isVirtual,
  isCompactSummary,
  summarizeMetadata,
  toolUseResult,
  mcpMeta,
  uuid,
  timestamp,
  imagePasteIds,
  sourceToolAssistantUUID,
  permissionMode,
  origin,
}: {
  content: string | ContentBlockParam[]
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  uuid?: UUID | string
  timestamp?: string
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  permissionMode?: PermissionMode
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  origin?: MessageOrigin
}): UserMessage {
  const m: UserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: content || NO_CONTENT_MESSAGE,
    },
    isMeta,
    isVisibleInTranscriptOnly,
    isVirtual,
    isCompactSummary,
    summarizeMetadata,
    uuid: (uuid as UUID | undefined) || randomUUID(),
    timestamp: timestamp ?? new Date().toISOString(),
    toolUseResult,
    mcpMeta,
    imagePasteIds,
    sourceToolAssistantUUID,
    permissionMode,
    origin,
  }
  return m
}

export function prepareUserContent({
  inputString,
  precedingInputBlocks,
}: {
  inputString: string
  precedingInputBlocks: ContentBlockParam[]
}): string | ContentBlockParam[] {
  if (precedingInputBlocks.length === 0) {
    return inputString
  }
  return [
    ...precedingInputBlocks,
    {
      text: inputString,
      type: 'text' as const,
    },
  ]
}

export function createUserInterruptionMessage({
  toolUse = false,
}: {
  toolUse?: boolean
}): UserMessage {
  const content = toolUse ? INTERRUPT_MESSAGE_FOR_TOOL_USE : INTERRUPT_MESSAGE
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: content,
      },
    ],
  })
}

export function isNotEmptyMessage(message: Message): boolean {
  if (message.type !== 'user' && message.type !== 'assistant') {
    return true
  }
  const content = message.message.content
  if (typeof content === 'string') {
    return content.trim().length > 0
  }
  if (content.length === 0) return false
  if (content.length > 1) return true
  const first = content[0]!
  if (first.type !== 'text') return true
  const text = (first as { text: string }).text
  return (
    text.trim().length > 0 &&
    text !== NO_CONTENT_MESSAGE &&
    text !== INTERRUPT_MESSAGE_FOR_TOOL_USE
  )
}

/**
 * Split messages so each content block gets its own message.
 */
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  let isNewChain = false
  return messages.flatMap((message): NormalizedMessage[] => {
    switch (message.type) {
      case 'assistant': {
        isNewChain = isNewChain || message.message.content.length > 1
        return message.message.content.map((block, index) => {
          return {
            type: 'assistant' as const,
            timestamp: message.timestamp,
            message: {
              ...message.message,
              content: [block],
            },
            uuid: isNewChain
              ? deriveUUID(message.uuid, index)
              : message.uuid,
          } as unknown as NormalizedAssistantMessage
        })
      }
      case 'user': {
        const content = message.message.content
        if (typeof content === 'string') {
          return [
            {
              type: 'user' as const,
              timestamp: message.timestamp,
              message: {
                role: 'user' as const,
                content: [{ type: 'text' as const, text: content }],
              },
              uuid: message.uuid,
            } as unknown as NormalizedUserMessage,
          ]
        }
        isNewChain = isNewChain || content.length > 1
        return content.map((block, index) => ({
          type: 'user' as const,
          timestamp: message.timestamp,
          message: {
            role: 'user' as const,
            content: [block],
          },
          uuid: isNewChain
            ? deriveUUID(message.uuid, index)
            : message.uuid,
        })) as unknown as NormalizedUserMessage[]
      }
      default:
        return []
    }
  })
}

export function extractTextContent(
  blocks: readonly { readonly type: string }[],
  separator = '',
): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join(separator)
}

type DeepImmutable<T> = T extends object
  ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
  : T

export function getContentText(
  content: string | DeepImmutable<Array<ContentBlockParam>>,
): string | null {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return extractTextContent(content, '\n').trim() || null
  }
  return null
}

export function getLastAssistantMessage(
  messages: Message[],
): AssistantMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.type === 'assistant') {
      return messages[i] as AssistantMessage
    }
  }
  return null
}

export function hasToolCallsInLastAssistantTurn(
  messages: Message[],
): boolean {
  const lastAssistant = getLastAssistantMessage(messages)
  if (!lastAssistant) return false
  return lastAssistant.message.content.some(
    block => block.type === 'tool_use',
  )
}

export function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`
}

export function stripPromptXMLTags(content: string): string {
  return content.replace(/<\/?(?:system-reminder|command-name)>/g, '')
}

export function isEmptyMessageText(text: string): boolean {
  const stripped = text.trim()
  return stripped === '' || stripped === NO_CONTENT_MESSAGE
}

export function getAssistantMessageText(message: Message): string | null {
  if (message.type !== 'assistant') return null
  return extractTextContent(message.message.content)
}

export function getUserMessageText(
  message: Message,
): string | null {
  if (message.type !== 'user') return null
  const content = message.message.content
  if (typeof content === 'string') return content
  return extractTextContent(content as readonly { readonly type: string }[])
}
