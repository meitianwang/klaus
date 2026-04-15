/**
 * Shim for color-diff-napi (unavailable native module).
 */

export class ColorDiff {
  diff() {
    return []
  }
}

export class ColorFile {}

export function getSyntaxTheme() {
  return null
}
