/**
 * Simplified thinking module for Klaus — adapted from claude-code's utils/thinking.ts.
 * Removes GrowthBook, feature flags, provider detection.
 * Hardcodes thinking as always available/enabled for Claude 4+ models.
 */

export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * Ultrathink is not supported in Klaus.
 */
export function isUltrathinkEnabled(): boolean {
  return false
}

export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(/\bultrathink\b/gi)
  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }
  return positions
}

/**
 * Check if a model supports thinking.
 * Simplified: all non-claude-3 models support thinking.
 */
export function modelSupportsThinking(model: string): boolean {
  const lower = model.toLowerCase()
  return !lower.includes('claude-3-')
}

/**
 * Check if a model supports adaptive thinking.
 * Simplified: opus-4-6 and sonnet-4-6 support adaptive thinking.
 */
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const lower = model.toLowerCase()
  if (lower.includes('opus-4-6') || lower.includes('sonnet-4-6')) {
    return true
  }
  if (
    lower.includes('opus') ||
    lower.includes('sonnet') ||
    lower.includes('haiku')
  ) {
    return false
  }
  // Default to true for unknown newer models
  return true
}

/**
 * Whether thinking should be enabled by default.
 */
export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }
  return true
}
