/**
 * Model utilities — simplified from claude-code's utils/model/model.ts.
 * Stripped: bootstrap/state dependency, subscription checks, auth, GrowthBook.
 * Preserved: type definitions and basic model classification helpers.
 */

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | null

/**
 * Check if a model name refers to a non-custom Opus model.
 */
export function isNonCustomOpusModel(model: ModelName): boolean {
  return /claude.*opus/i.test(model)
}

/**
 * Check if a model name refers to a Haiku model.
 */
export function isHaikuModel(model: ModelName): boolean {
  return /claude.*haiku/i.test(model)
}

/**
 * Check if a model name refers to a Sonnet model.
 */
export function isSonnetModel(model: ModelName): boolean {
  return /claude.*sonnet/i.test(model)
}

/**
 * Get the small fast model name for auxiliary tasks.
 */
export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || 'claude-sonnet-4-20250514'
}
