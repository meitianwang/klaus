/**
 * semanticBoolean -- Zod preprocess wrapper that coerces string booleans.
 * Adapted from claude-code's utils/semanticBoolean.ts.
 */
import { z } from 'zod/v4'

export function semanticBoolean<T extends z.ZodTypeAny>(schema: T): T {
  return z.preprocess((val: unknown) => {
    if (typeof val === 'string') {
      if (val === 'true') return true
      if (val === 'false') return false
    }
    return val
  }, schema) as unknown as T
}
