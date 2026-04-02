/**
 * Core query loop — adapted from claude-code's query.ts.
 * This is the main agent loop: API call → tool execution → repeat.
 * Stripped: feature flags, analytics, context collapse, snip, skill prefetch, token budget.
 * Preserved: main loop, autocompact, tool execution, prompt-too-long recovery, max-output-tokens recovery.
 */

import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  TombstoneMessage,
  ToolUseSummaryMessage,
  UserMessage,
} from './types/message.js'
import type { SystemPrompt } from './utils/systemPromptType.js'
import type { CanUseToolFn, ToolUseContext, Tools } from './Tool.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import type { QuerySource } from './constants/querySource.js'
import {
  queryModelWithStreaming,
  normalizeMessagesForAPI,
  buildToolSchemas,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  type Options as ApiOptions,
} from './services/api/claude.js'
import { runTools, type MessageUpdate } from './services/tools/toolOrchestration.js'
import {
  shouldAutoCompact,
  autoCompactIfNeeded,
  type AutoCompactTrackingState,
} from './services/compact/autoCompact.js'
import { buildPostCompactMessages } from './services/compact/compact.js'
import { microcompactMessages } from './services/compact/microCompact.js'
import { tokenCountWithEstimation } from './utils/tokens.js'
import { ESCALATED_MAX_TOKENS } from './utils/context.js'
import { randomUUID } from 'crypto'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createBudgetTracker, checkTokenBudget } from './query/tokenBudget.js'

// ============================================================================
// Types
// ============================================================================

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  /** API key for Anthropic */
  apiKey: string
  /** Base URL for Anthropic API */
  baseURL?: string
  /** Max context tokens (from SettingsStore) */
  maxContextTokens?: number
  /** Pre-built tool schemas (optional, built from tools if not provided) */
  toolSchemas?: BetaToolUnion[]
  /** Token budget — auto-continue until this many output tokens reached */
  tokenBudget?: number | null
}

type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  turnCount: number
}

export type Terminal = { reason: 'end_turn' | 'max_turns' | 'error'; turnCount: number }

// ============================================================================
// Main query function
// ============================================================================

export async function* query(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
> {
  return yield* queryLoop(params)
}

// ============================================================================
// Query loop
// ============================================================================

async function* queryLoop(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
> {
  const {
    systemPrompt,
    canUseTool,
    querySource,
    maxTurns = 100,
    apiKey,
    baseURL,
    maxContextTokens,
    tokenBudget,
  } = params

  const budgetTracker = tokenBudget ? createBudgetTracker() : null

  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
  }

  // Build tool schemas once (or use pre-built)
  let toolSchemas = params.toolSchemas
  if (!toolSchemas) {
    toolSchemas = await buildToolSchemas(
      state.toolUseContext.options.tools,
      {
        toolPermissionContext: (state.toolUseContext.getAppState() as any).toolPermissionContext ?? getEmptyToolPermissionContext(),
        isNonInteractiveSession: state.toolUseContext.options.isNonInteractiveSession,
      },
    )
  }

  while (true) {
    const { toolUseContext } = state

    // ---- Microcompact: clear old tool results before autocompact ----
    const mcResult = microcompactMessages(state.messages)
    if (mcResult.messages !== state.messages) {
      // microcompact returned new array — update in-place
      state.messages.length = 0
      state.messages.push(...mcResult.messages)
    }

    const { messages } = state

    // ---- Auto-compact check ----
    const compactResult = await autoCompactIfNeeded(
      messages,
      toolUseContext,
      querySource,
      state.autoCompactTracking,
      maxContextTokens,
    )

    if (compactResult.wasCompacted && compactResult.compactionResult) {
      const postCompactMessages = buildPostCompactMessages(compactResult.compactionResult)
      // Replace messages with compacted version
      state.messages.length = 0
      state.messages.push(...postCompactMessages)

      state.autoCompactTracking = {
        compacted: true,
        turnCounter: state.turnCount,
        turnId: randomUUID(),
        consecutiveFailures: compactResult.consecutiveFailures,
      }

      // Yield compaction events
      toolUseContext.onCompactProgress?.({ type: 'compact_end' })
    } else if (compactResult.consecutiveFailures !== undefined) {
      state.autoCompactTracking = {
        ...(state.autoCompactTracking ?? {
          compacted: false,
          turnCounter: 0,
          turnId: randomUUID(),
        }),
        consecutiveFailures: compactResult.consecutiveFailures,
      }
    }

    // ---- API call ----
    const apiOptions: ApiOptions = {
      model: toolUseContext.options.mainLoopModel,
      apiKey,
      baseURL,
      maxOutputTokensOverride: state.maxOutputTokensOverride,
      querySource,
      maxContextTokens,
    }

    let assistantMessage: AssistantMessage | undefined
    let isPromptTooLong = false
    let isMaxOutputTokens = false

    const gen = queryModelWithStreaming({
      messages: state.messages,
      systemPrompt,
      thinkingConfig: toolUseContext.options.thinkingConfig,
      tools: toolUseContext.options.tools,
      toolSchemas,
      signal: toolUseContext.abortController.signal,
      options: apiOptions,
    })

    for await (const event of gen) {
      if (event.type === 'stream_request_start') {
        yield event as StreamEvent
      } else if (event.type === 'assistant') {
        assistantMessage = event as AssistantMessage

        // Check for error conditions
        if (assistantMessage.isApiErrorMessage) {
          const errorText = getAssistantText(assistantMessage)
          if (errorText?.includes(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
            isPromptTooLong = true
          }
        }

        // Check stop reason for max_tokens
        if (assistantMessage.message.stop_reason === 'max_tokens') {
          isMaxOutputTokens = true
        }

        yield assistantMessage
      }
    }

    if (!assistantMessage) {
      return { reason: 'error', turnCount: state.turnCount }
    }

    // ---- Error recovery: prompt too long ----
    if (isPromptTooLong && !state.hasAttemptedReactiveCompact) {
      console.warn('[Query] Prompt too long — attempting reactive compact')
      state.hasAttemptedReactiveCompact = true

      try {
        const { compactConversation } = await import('./services/compact/compact.js')
        const compactionResult = await compactConversation(
          state.messages,
          toolUseContext,
          true,
          undefined,
          true,
        )
        const postCompactMessages = buildPostCompactMessages(compactionResult)
        state.messages.length = 0
        state.messages.push(...postCompactMessages)
        continue // Retry with compacted messages
      } catch (compactError) {
        console.error('[Query] Reactive compact failed:', compactError)
        return { reason: 'error', turnCount: state.turnCount }
      }
    } else if (isPromptTooLong) {
      return { reason: 'error', turnCount: state.turnCount }
    }

    // ---- Error recovery: max output tokens ----
    if (isMaxOutputTokens && state.maxOutputTokensRecoveryCount < 3) {
      state.maxOutputTokensRecoveryCount++

      // Escalate max tokens on first recovery
      if (state.maxOutputTokensRecoveryCount === 1) {
        state.maxOutputTokensOverride = ESCALATED_MAX_TOKENS
      }

      // Add assistant message and a "please continue" user message
      state.messages.push(assistantMessage)
      state.messages.push({
        type: 'user',
        message: { role: 'user', content: 'Please continue from where you left off.' },
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      } as UserMessage)

      state.turnCount++
      continue
    }

    // ---- Extract tool_use blocks ----
    const toolUseBlocks = assistantMessage.message.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use',
    )

    // No tool calls → conversation turn is complete
    if (toolUseBlocks.length === 0) {
      state.messages.push(assistantMessage)

      // ---- Token budget check: auto-continue if budget not reached ----
      if (budgetTracker && tokenBudget) {
        // Sum output tokens from all assistant messages
        let totalOutputTokens = 0
        for (const msg of state.messages) {
          if (msg.type === 'assistant') {
            const usage = (msg as any).message?.usage
            if (usage?.output_tokens) {
              totalOutputTokens += usage.output_tokens
            }
          }
        }

        const decision = checkTokenBudget(
          budgetTracker,
          toolUseContext.agentId,
          tokenBudget,
          totalOutputTokens,
        )

        if (decision.action === 'continue') {
          console.log(
            `[Query] Token budget continuation #${decision.continuationCount}: ${decision.pct}% (${decision.turnTokens.toLocaleString()} / ${decision.budget.toLocaleString()})`,
          )
          state.messages.push({
            type: 'user',
            message: { role: 'user', content: decision.nudgeMessage },
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
          } as UserMessage)
          state.turnCount++
          continue
        }
      }

      return { reason: 'end_turn', turnCount: state.turnCount }
    }

    // ---- Execute tools ----
    state.messages.push(assistantMessage)

    const toolResults = runTools(
      toolUseBlocks,
      [assistantMessage],
      canUseTool,
      toolUseContext,
    )

    for await (const update of toolResults) {
      if (update.message) {
        state.messages.push(update.message)
        yield update.message
      }
      // Update context if modified by tool
      state.toolUseContext = update.newContext
    }

    // ---- Check turn limit ----
    state.turnCount++
    if (state.turnCount > maxTurns) {
      console.warn(`[Query] Max turns (${maxTurns}) reached`)
      return { reason: 'max_turns', turnCount: state.turnCount }
    }

    // Reset max output tokens recovery for next iteration
    state.maxOutputTokensRecoveryCount = 0
    state.maxOutputTokensOverride = params.maxOutputTokensOverride
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getAssistantText(msg: AssistantMessage): string | null {
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      return (block as { type: 'text'; text: string }).text
    }
  }
  return null
}
