/**
 * Runtime shim for bun:bundle module.
 *
 * In Anthropic's internal builds, bun's bundler replaces feature() calls
 * at compile time. This runtime shim is used for dev/source builds where
 * bun:bundle is not available as a native module.
 *
 * Set CLAUDE_CODE_FEATURES env var to enable specific features:
 *   CLAUDE_CODE_FEATURES=BUDDY,BRIDGE_MODE,DAEMON bun run dev
 */

const enabledFeatures = new Set(
  (process.env.CLAUDE_CODE_FEATURES ?? "").split(",").filter(Boolean),
);

export function feature(name: string): boolean {
  return enabledFeatures.has(name);
}
