/**
 * Shim for url-handler-napi (unavailable native module).
 */

export async function waitForUrlEvent(..._args: unknown[]): Promise<string | undefined> {
  return undefined
}

export default undefined
