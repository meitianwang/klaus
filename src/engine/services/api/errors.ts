/**
 * API error constants and utilities — adapted from claude-code's services/api/errors.ts.
 * Stripped: auth, model, analytics, format, CCR, rate limit mocking, tool_use mismatch logging.
 * Preserved: error message constants, error classification, prompt-too-long detection.
 */

import type { AssistantMessage, Message } from '../../types/message.js'

// ============================================================================
// Error message constants
// ============================================================================

export const API_ERROR_MESSAGE_PREFIX = 'API Error'
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Invalid API key'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'

// ============================================================================
// Error detection utilities
// ============================================================================

export function startsWithApiErrorPrefix(text: string): boolean {
  return text.startsWith(API_ERROR_MESSAGE_PREFIX)
}

export function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  if (!msg.isApiErrorMessage) {
    return false
  }
  const content = msg.message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    (block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      (block as { type: string }).type === 'text' &&
      'text' in block &&
      typeof (block as { text: string }).text === 'string' &&
      (block as { text: string }).text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
  )
}

export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  }
}

export function getPromptTooLongTokenGap(
  msg: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(msg) || !msg.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    msg.errorDetails,
  )
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined
  }
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

export function isMediaSizeError(raw: string): boolean {
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

export function isMediaSizeErrorMessage(msg: AssistantMessage): boolean {
  return (
    msg.isApiErrorMessage === true &&
    msg.errorDetails !== undefined &&
    isMediaSizeError(msg.errorDetails)
  )
}

// ============================================================================
// Error classification (simplified)
// ============================================================================

export type APIErrorCategory =
  | 'prompt_too_long'
  | 'invalid_api_key'
  | 'credit_balance'
  | 'rate_limit'
  | 'overloaded'
  | 'media_size'
  | 'timeout'
  | 'connection'
  | 'unknown'

export function classifyAPIError(
  status: number | undefined,
  message: string,
): APIErrorCategory {
  if (message.includes('prompt is too long')) return 'prompt_too_long'
  if (status === 401) return 'invalid_api_key'
  if (status === 402) return 'credit_balance'
  if (status === 429) return 'rate_limit'
  if (status === 529) return 'overloaded'
  if (isMediaSizeError(message)) return 'media_size'
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout'
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) return 'connection'
  return 'unknown'
}
