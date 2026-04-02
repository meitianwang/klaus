/**
 * Context window utilities — adapted from claude-code's utils/context.ts.
 * Simplified: removed model detection logic (Klaus passes maxContextTokens from SettingsStore).
 */

// Model context window size (200k tokens for all models right now)
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000

// Capped default for slot-reservation optimization
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

/**
 * Get context window size for a model.
 * Klaus passes maxContextTokens from SettingsStore, so this is simplified.
 */
export function getContextWindowForModel(
  model: string,
  _betas?: string[],
): number {
  // Check for [1m] suffix
  if (/\[1m\]/i.test(model)) {
    return 1_000_000
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  const m = model.toLowerCase()

  if (m.includes('opus-4-6')) {
    return { default: 64_000, upperLimit: 128_000 }
  }
  if (m.includes('sonnet-4-6')) {
    return { default: 32_000, upperLimit: 128_000 }
  }
  if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (m.includes('opus-4')) {
    return { default: 32_000, upperLimit: 32_000 }
  }
  if (m.includes('3-7-sonnet')) {
    return { default: 32_000, upperLimit: 64_000 }
  }

  return { default: MAX_OUTPUT_TOKENS_DEFAULT, upperLimit: 64_000 }
}

export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}

export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}
