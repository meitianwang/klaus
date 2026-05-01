/**
 * Runtime shim for bun:bundle module.
 *
 * In Anthropic's internal builds, bun's bundler replaces feature() calls
 * at compile time. This runtime shim is used for dev/source builds where
 * bun:bundle is not available as a native module.
 *
 * Set CLAUDE_CODE_FEATURES env var to enable specific features:
 *   CLAUDE_CODE_FEATURES=BUDDY,BRIDGE_MODE,DAEMON bun run dev
 *
 * Klaus 改动：每次调用都重读 process.env，让 main 进程根据 SettingsStore
 * 写入的 env vars 能在运行时即时生效（无需 require 引擎模块前固化）。
 * 性能开销忽略不计 —— feature() 不在热路径，且只是一次 split。
 */
export function feature(name: string): boolean {
  const enabled = (process.env.CLAUDE_CODE_FEATURES ?? "").split(",").filter(Boolean);
  return enabled.includes(name);
}
