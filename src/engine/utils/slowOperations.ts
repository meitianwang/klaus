/**
 * Slow operations utilities — extracted from claude-code's utils/slowOperations.ts.
 * Only includes jsonStringify.
 */

export function jsonStringify(value: unknown): string
export function jsonStringify(
  value: unknown,
  replacer?: (key: string, value: unknown) => unknown,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?: (key: string, value: unknown) => unknown,
  space?: string | number,
): string {
  try {
    return JSON.stringify(value, replacer, space)
  } catch {
    return String(value)
  }
}
