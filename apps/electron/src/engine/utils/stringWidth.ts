/**
 * Returns the visual width of a string, stripping ANSI escape codes.
 */
export function stringWidth(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').length
}

export function wrapAnsi(text: string, ..._args: any[]): string { return text }

export function supportsHyperlinks() { return false }
