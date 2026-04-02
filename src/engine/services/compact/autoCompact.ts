/**
 * Auto-compaction — adapted from claude-code's services/compact/autoCompact.ts.
 * Stripped: feature flags, session memory compaction, GrowthBook, context collapse.
 * Preserved: threshold calculation, circuit breaker, core auto-compact logic.
 */

import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
} from './compact.js'

// Reserve tokens for output during compaction
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

export function getEffectiveContextWindowSize(
  model: string,
  maxContextTokens?: number,
): number {
  const contextWindow = maxContextTokens ?? getContextWindowForModel(model)
  return contextWindow - MAX_OUTPUT_TOKENS_FOR_SUMMARY
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  turnId: string
  consecutiveFailures?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export function getAutoCompactThreshold(
  model: string,
  maxContextTokens?: number,
): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model, maxContextTokens)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
  maxContextTokens?: number,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model, maxContextTokens)
  const threshold = autoCompactThreshold
  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= warningThreshold

  const isAboveAutoCompactThreshold = tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model, maxContextTokens)
  const blockingLimit = actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS
  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  maxContextTokens?: number,
): Promise<boolean> {
  // Don't auto-compact during compaction or session memory queries
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }

  const tokenCount = tokenCountWithEstimation(messages)
  const threshold = getAutoCompactThreshold(model, maxContextTokens)

  console.log(
    `[AutoCompact] tokens=${tokenCount} threshold=${threshold}`,
  )

  return tokenCount >= threshold
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  maxContextTokens?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
  // Circuit breaker
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    maxContextTokens,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      true, // suppressFollowUpQuestions
      undefined, // customInstructions
      true, // isAutoCompact
    )

    return {
      wasCompacted: true,
      compactionResult,
      consecutiveFailures: 0,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg !== ERROR_MESSAGE_USER_ABORT) {
      console.error('[AutoCompact] Compaction failed:', msg)
    }
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      console.warn(
        `[AutoCompact] Circuit breaker tripped after ${nextFailures} consecutive failures`,
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
