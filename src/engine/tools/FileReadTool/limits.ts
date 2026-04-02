/**
 * Read tool output limits -- simplified from claude-code's limits.ts.
 * Removed GrowthBook dependency; uses static defaults.
 */
import { MAX_OUTPUT_SIZE } from '../../utils/file.js'

export const DEFAULT_MAX_OUTPUT_TOKENS = 25000

function getEnvMaxTokens(): number | undefined {
  const override = process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS
  if (override) {
    const parsed = parseInt(override, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

export type FileReadingLimits = {
  maxTokens: number
  maxSizeBytes: number
  includeMaxSizeInPrompt?: boolean
  targetedRangeNudge?: boolean
}

let _cached: FileReadingLimits | undefined

export function getDefaultFileReadingLimits(): FileReadingLimits {
  if (_cached) return _cached

  const envMaxTokens = getEnvMaxTokens()

  _cached = {
    maxSizeBytes: MAX_OUTPUT_SIZE,
    maxTokens: envMaxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
  return _cached
}
