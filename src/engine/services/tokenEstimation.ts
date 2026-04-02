/**
 * Simplified token estimation — extracted from claude-code's services/tokenEstimation.ts.
 * Only includes rough estimation functions (no API-based counting).
 */

import type { Anthropic } from '@anthropic-ai/sdk'
import { jsonStringify } from '../utils/slowOperations.js'

export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

export function roughTokenCountEstimationForMessages(
  messages: readonly {
    type: string
    message?: { content?: unknown }
    attachment?: unknown
  }[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}

function roughTokenCountEstimationForMessage(message: {
  type: string
  message?: { content?: unknown }
  attachment?: unknown
}): number {
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message?.content
  ) {
    return roughTokenCountEstimationForContent(
      message.message?.content as
        | string
        | Array<Anthropic.ContentBlock>
        | Array<Anthropic.ContentBlockParam>
        | undefined,
    )
  }
  return 0
}

function roughTokenCountEstimationForContent(
  content:
    | string
    | Array<Anthropic.ContentBlock>
    | Array<Anthropic.ContentBlockParam>
    | undefined,
): number {
  if (!content) return 0
  if (typeof content === 'string') return roughTokenCountEstimation(content)
  let totalTokens = 0
  for (const block of content) {
    totalTokens += roughTokenCountEstimationForBlock(block)
  }
  return totalTokens
}

function roughTokenCountEstimationForBlock(
  block: string | Anthropic.ContentBlock | Anthropic.ContentBlockParam,
): number {
  if (typeof block === 'string') return roughTokenCountEstimation(block)
  if (block.type === 'text') return roughTokenCountEstimation(block.text)
  if (block.type === 'image' || block.type === 'document') return 2000
  if (block.type === 'tool_result') {
    return roughTokenCountEstimationForContent(block.content as any)
  }
  if (block.type === 'tool_use') {
    return roughTokenCountEstimation(
      block.name + jsonStringify(block.input ?? {}),
    )
  }
  if (block.type === 'thinking') {
    return roughTokenCountEstimation((block as { thinking: string }).thinking)
  }
  if (block.type === 'redacted_thinking') {
    return roughTokenCountEstimation((block as { data: string }).data)
  }
  return roughTokenCountEstimation(jsonStringify(block))
}
