/**
 * semanticNumber -- Zod preprocess wrapper that coerces string numbers.
 * Adapted from claude-code's utils/semanticNumber.ts.
 */
import { z } from 'zod/v4'

export function semanticNumber<T extends z.ZodTypeAny>(schema: T): T {
  return z.preprocess((val: unknown) => {
    if (typeof val === 'string') {
      const n = Number(val)
      if (!isNaN(n)) return n
    }
    return val
  }, schema) as unknown as T
}
