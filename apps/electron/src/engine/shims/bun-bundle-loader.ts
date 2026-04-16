/**
 * ESM resolve hook — intercepts `bun:bundle` and redirects to local shim.
 */

const shimURL = new URL('./bun-bundle.ts', import.meta.url).href
const sandboxShimURL = new URL('./pkg-sandbox-runtime.ts', import.meta.url).href
const antStubsURL = new URL('./pkg-ant-stubs.ts', import.meta.url).href

const SHIMMED_PACKAGES: Record<string, string> = {
  'bun:bundle': shimURL,
  '@anthropic-ai/sandbox-runtime': sandboxShimURL,
  '@anthropic-ai/mcpb': antStubsURL,
}

export function resolve(specifier: string, context: any, nextResolve: any) {
  const shimUrl = SHIMMED_PACKAGES[specifier]
  if (shimUrl) {
    return { url: shimUrl, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
