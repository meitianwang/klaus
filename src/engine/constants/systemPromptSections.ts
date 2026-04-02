/**
 * System prompt section memoization — adapted from claude-code's
 * constants/systemPromptSections.ts.
 *
 * Sections are computed once and cached until clearSystemPromptSections()
 * is called (on session reset or compact). Volatile sections (cacheBreak=true)
 * recompute every turn.
 */

type ComputeFn = () => string | null | Promise<string | null>

export type SystemPromptSection = {
  name: string
  compute: ComputeFn
  cacheBreak: boolean
}

const sectionCache = new Map<string, string | null>()

/**
 * Create a memoized section. Computed once, cached until clear.
 */
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile section that recomputes every turn and breaks prompt cache.
 * Use sparingly — each call invalidates the cached prefix.
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}

/**
 * Resolve all sections, using cache for non-cacheBreak sections.
 */
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  return Promise.all(
    sections.map(async (s) => {
      if (!s.cacheBreak && sectionCache.has(s.name)) {
        return sectionCache.get(s.name) ?? null
      }
      const value = await s.compute()
      sectionCache.set(s.name, value)
      return value
    }),
  )
}

/**
 * Clear all cached sections. Called on session reset and compact.
 */
export function clearSystemPromptSections(): void {
  sectionCache.clear()
}
