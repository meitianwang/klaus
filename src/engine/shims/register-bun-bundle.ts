/**
 * ESM loader hook for Klaus.
 * 1. Redirects `bun:bundle` imports to the local shim.
 * 2. Injects a per-module `require` function into globalThis so claude-code's
 *    conditional require() calls (behind feature() gates) don't throw ReferenceError.
 */
import { register } from 'node:module'

// Enable engine feature gates (normally set via CLAUDE_CODE_FEATURES env var)
process.env.CLAUDE_CODE_FEATURES = [
  process.env.CLAUDE_CODE_FEATURES,
  'EXTRACT_MEMORIES',
  'CONTEXT_COLLAPSE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
].filter(Boolean).join(',')

// Inject build-time MACRO constants (normally injected by Bun.build define)
;(globalThis as any).MACRO = {
  VERSION: '2.1.88',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '',
  FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
  ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
  VERSION_CHANGELOG: '',
  IS_CI: false,
}

register(new URL('./bun-bundle-loader.ts', import.meta.url))
