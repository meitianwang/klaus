/**
 * API retry logic — adapted from claude-code's services/api/withRetry.ts.
 * Stripped: analytics, feature(), fastMode, auth, rateLimitMocking, proxy, aws, vertex, oauth.
 * Preserved: retry logic (exponential backoff), API error handling, error classes.
 */

import type Anthropic from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import type { QuerySource } from '../../constants/querySource.js'
import type { SystemAPIErrorMessage } from '../../types/message.js'
import { errorMessage } from '../../utils/errors.js'
import type { ThinkingConfig } from '../../Tool.js'
import { REPEATED_529_ERROR_MESSAGE } from './errors.js'

function sleep(ms: number, signal?: AbortSignal, opts?: { abortError: () => Error }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(opts?.abortError?.() ?? new APIUserAbortError())
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(opts?.abortError?.() ?? new APIUserAbortError())
    }, { once: true })
  })
}

function createSystemAPIErrorMessage(
  error: APIError,
  delayMs: number,
  attempt: number,
  maxRetries: number,
): SystemAPIErrorMessage {
  return {
    type: 'system',
    subtype: 'api_error',
    uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    timestamp: new Date().toISOString(),
    isMeta: true,
    error: `API error (${error.status}): ${error.message}`,
    retryInMs: delayMs,
    retryAttempt: attempt,
    maxRetries,
  }
}

function extractConnectionErrorDetails(
  error: unknown,
): { code: string; message: string } | null {
  if (!error || typeof error !== 'object') return null
  let current: unknown = error
  let depth = 0
  while (current && depth < 5) {
    if (
      current instanceof Error &&
      'code' in current &&
      typeof current.code === 'string'
    ) {
      return { code: current.code, message: current.message }
    }
    if (
      current instanceof Error &&
      'cause' in current &&
      current.cause !== current
    ) {
      current = current.cause
      depth++
    } else {
      break
    }
  }
  return null
}

const abortError = () => new APIUserAbortError()

const DEFAULT_MAX_RETRIES = 10
const FLOOR_OUTPUT_TOKENS = 3000
const MAX_529_RETRIES = 3
export const BASE_DELAY_MS = 500

const FOREGROUND_529_RETRY_SOURCES = new Set<QuerySource>([
  'repl_main_thread',
  'sdk',
  'compact',
])

function shouldRetry529(querySource: QuerySource | undefined): boolean {
  return (
    querySource === undefined || FOREGROUND_529_RETRY_SOURCES.has(querySource)
  )
}

function isStaleConnectionError(error: unknown): boolean {
  if (!(error instanceof APIConnectionError)) {
    return false
  }
  const details = extractConnectionErrorDetails(error)
  return details?.code === 'ECONNRESET' || details?.code === 'EPIPE'
}

export interface RetryContext {
  maxTokensOverride?: number
  model: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
}

interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  fastMode?: boolean
  signal?: AbortSignal
  querySource?: QuerySource
  initialConsecutive529Errors?: number
}

export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    const message = errorMessage(originalError)
    super(message)
    this.name = 'RetryError'

    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}

export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
  ) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`)
    this.name = 'FallbackTriggeredError'
  }
}

export async function* withRetry<T>(
  getClient: () => Promise<Anthropic>,
  operation: (
    client: Anthropic,
    attempt: number,
    context: RetryContext,
  ) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = getMaxRetries(options)
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
  }
  let client: Anthropic | null = null
  let consecutive529Errors = options.initialConsecutive529Errors ?? 0
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new APIUserAbortError()
    }

    try {
      // Get a fresh client on first attempt or after auth/connection errors
      if (
        client === null ||
        (lastError instanceof APIError && lastError.status === 401) ||
        isStaleConnectionError(lastError)
      ) {
        client = await getClient()
      }

      return await operation(client, attempt, retryContext)
    } catch (error) {
      lastError = error

      // Non-foreground sources bail immediately on 529
      if (is529Error(error) && !shouldRetry529(options.querySource)) {
        throw new CannotRetryError(error, retryContext)
      }

      // Track consecutive 529 errors
      if (is529Error(error)) {
        consecutive529Errors++
        if (consecutive529Errors >= MAX_529_RETRIES) {
          if (options.fallbackModel) {
            throw new FallbackTriggeredError(
              options.model,
              options.fallbackModel,
            )
          }

          throw new CannotRetryError(
            new Error(REPEATED_529_ERROR_MESSAGE),
            retryContext,
          )
        }
      }

      // Only retry if the error indicates we should
      if (attempt > maxRetries) {
        throw new CannotRetryError(error, retryContext)
      }

      if (!(error instanceof APIError) || !shouldRetry(error)) {
        throw new CannotRetryError(error, retryContext)
      }

      // Handle max tokens context overflow errors
      if (error instanceof APIError) {
        const overflowData = parseMaxTokensContextOverflowError(error)
        if (overflowData) {
          const { inputTokens, contextLimit } = overflowData
          const safetyBuffer = 1000
          const availableContext = Math.max(
            0,
            contextLimit - inputTokens - safetyBuffer,
          )
          if (availableContext < FLOOR_OUTPUT_TOKENS) {
            throw error
          }
          const minRequired =
            (retryContext.thinkingConfig.type === 'enabled'
              ? retryContext.thinkingConfig.budgetTokens
              : 0) + 1
          const adjustedMaxTokens = Math.max(
            FLOOR_OUTPUT_TOKENS,
            availableContext,
            minRequired,
          )
          retryContext.maxTokensOverride = adjustedMaxTokens
          continue
        }
      }

      // Normal retry with exponential backoff
      const retryAfter = getRetryAfter(error)
      const delayMs = getRetryDelay(attempt, retryAfter)

      if (error instanceof APIError) {
        yield createSystemAPIErrorMessage(error, delayMs, attempt, maxRetries)
      }
      await sleep(delayMs, options.signal, { abortError })
    }
  }

  throw new CannotRetryError(lastError, retryContext)
}

function getRetryAfter(error: unknown): string | null {
  return (
    ((error as { headers?: { 'retry-after'?: string } }).headers?.[
      'retry-after'
    ] ||
      ((error as APIError).headers as Headers)?.get?.('retry-after')) ??
    null
  )
}

export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

export function parseMaxTokensContextOverflowError(error: APIError):
  | {
      inputTokens: number
      maxTokens: number
      contextLimit: number
    }
  | undefined {
  if (error.status !== 400 || !error.message) {
    return undefined
  }

  if (
    !error.message.includes(
      'input length and `max_tokens` exceed context limit',
    )
  ) {
    return undefined
  }

  const regex =
    /input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/
  const match = error.message.match(regex)

  if (!match || match.length !== 4) {
    return undefined
  }

  if (!match[1] || !match[2] || !match[3]) {
    return undefined
  }
  const inputTokens = parseInt(match[1], 10)
  const maxTokens = parseInt(match[2], 10)
  const contextLimit = parseInt(match[3], 10)

  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit)) {
    return undefined
  }

  return { inputTokens, maxTokens, contextLimit }
}

export function is529Error(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }
  return (
    error.status === 529 ||
    (error.message?.includes('"type":"overloaded_error"') ?? false)
  )
}

function shouldRetry(error: APIError): boolean {
  if (error.message?.includes('"type":"overloaded_error"')) {
    return true
  }

  if (parseMaxTokensContextOverflowError(error)) {
    return true
  }

  const shouldRetryHeader = error.headers?.get('x-should-retry')
  if (shouldRetryHeader === 'true') {
    return true
  }
  if (shouldRetryHeader === 'false') {
    return false
  }

  if (error instanceof APIConnectionError) {
    return true
  }

  if (!error.status) return false

  // Retry on request timeouts
  if (error.status === 408) return true
  // Retry on lock timeouts
  if (error.status === 409) return true
  // Retry on rate limits
  if (error.status === 429) return true
  // Retry on auth errors (client will be refreshed)
  if (error.status === 401) return true
  // Retry internal errors
  if (error.status >= 500) return true

  return false
}

export function getDefaultMaxRetries(): number {
  if (process.env.CLAUDE_CODE_MAX_RETRIES) {
    return parseInt(process.env.CLAUDE_CODE_MAX_RETRIES, 10)
  }
  return DEFAULT_MAX_RETRIES
}

function getMaxRetries(options: RetryOptions): number {
  return options.maxRetries ?? getDefaultMaxRetries()
}
