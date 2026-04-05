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

// Redirect engine config dir from ~/.claude to ~/.klaus
// This controls skill scanning (getClaudeConfigHomeDir()/skills), config files, etc.
import { homedir } from 'os'
import { join } from 'path'
process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.klaus')

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

// Patch CJS require to handle ESM-only packages (unicorn-magic, etc.)
// Some packages only export ESM ("import" in exports, no "require").
// When createRequire's require() tries to load them via CJS, it fails.
// This patch catches ERR_PACKAGE_PATH_NOT_EXPORTED and falls back to dynamic import.
import Module from 'node:module'
const origResolve = (Module as any)._resolveFilename
;(Module as any)._resolveFilename = function(request: string, parent: any, isMain: boolean, options: any) {
  try {
    return origResolve.call(this, request, parent, isMain, options)
  } catch (err: any) {
    if (err?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      // ESM-only package being loaded via CJS require.
      // Return the empty-module shim so require() returns {} silently.
      return new URL('./empty-module.cjs', import.meta.url).pathname
    }
    throw err
  }
}

register(new URL('./bun-bundle-loader.ts', import.meta.url))
