/**
 * Shim for bun:ffi (unavailable in Node.js).
 */

export function dlopen(..._args: unknown[]): unknown {
  throw new Error('bun:ffi is not available in Node.js')
}

export default undefined
