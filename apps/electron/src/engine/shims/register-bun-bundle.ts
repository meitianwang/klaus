// @ts-nocheck — Bun-specific preload script
/**
 * Bun preload script for Klaus.
 * 1. Redirects `bun:bundle` to the local runtime shim (feature flags via env vars).
 * 2. Redirects Ant-internal packages to stub shims.
 * 3. Sets up CLAUDE_CONFIG_DIR, CLAUDE_CODE_FEATURES, and MACRO globals.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Environment & globals
// ---------------------------------------------------------------------------

process.env.CLAUDE_CODE_FEATURES = [
  process.env.CLAUDE_CODE_FEATURES,
  'EXTRACT_MEMORIES',
  'CONTEXT_COLLAPSE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'TRANSCRIPT_CLASSIFIER',
  'BASH_CLASSIFIER',
  'FORK_SUBAGENT',
].filter(Boolean).join(',')

process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.klaus')
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'

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

// ---------------------------------------------------------------------------
// Module resolution shims (Bun runtime plugin)
// ---------------------------------------------------------------------------

const shimDir = import.meta.dir
const shimPath = (file: string) => join(shimDir, file)

const SHIMS: Record<string, string> = {
  'bun:bundle':                     shimPath('bun-bundle.ts'),
  '@anthropic-ai/sandbox-runtime':  shimPath('pkg-sandbox-runtime.ts'),
  '@anthropic-ai/mcpb':             shimPath('pkg-ant-stubs.ts'),
}

Bun.plugin({
  name: 'klaus-shims',
  setup(build) {
    for (const [specifier, path] of Object.entries(SHIMS)) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({ path }))
    }
  },
})
