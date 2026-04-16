/**
 * Shim for image-processor-napi (unavailable native module).
 */

export function sharp(..._args: unknown[]): unknown {
  throw new Error('Image processor is not available')
}

export interface NativeClipboardResult {
  png: Buffer
  originalWidth: number
  originalHeight: number
  width: number
  height: number
}

export function getNativeModule(): {
  hasClipboardImage?: () => boolean
  readClipboardImage?: (maxWidth?: number, maxHeight?: number) => NativeClipboardResult | null
} | undefined {
  return undefined
}

export default undefined
