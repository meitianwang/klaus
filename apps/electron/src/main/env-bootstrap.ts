// Pre-flight env setup — MUST be the very first import in main/index.ts so it
// evaluates before the engine module chain. CC's stopHooks.ts:43 (and a few
// other engine files) decide at *module load time* whether to lazy-require
// optional submodules based on feature() / process.env.X. ESM evaluates the
// deepest dependency first, so if these env vars are set in main/index.ts'
// top-level statements they'd land *after* stopHooks.ts has already cached
// `null` — leaving extractMemoriesModule null but feature('EXTRACT_MEMORIES')
// later returning true, which crashes with "Cannot read properties of null
// (reading 'executeExtractMemories')" the first time stop hooks fire.
//
// Putting the assignments in this file and importing it as the very first
// statement guarantees they run before any engine module is evaluated.

import { join } from 'path'
import { homedir } from 'os'

// Ensure we run as Electron app, not Node.js (Claude Code sets ELECTRON_RUN_AS_NODE=1)
delete process.env.ELECTRON_RUN_AS_NODE

// 把 CC 引擎的 home 重定向到 ~/.klaus — skills / MCP / settings / permissions / user memory 全局共享到这里
// 必须在任何 engine 模块加载前设置，getClaudeConfigHomeDir() 会读这个 env
process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.klaus')
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'

// CC 引擎的 MACRO 全局 — bundle 里只有 `MACRO.VERSION` 之类的运行时引用，没有编译期替换
// Web 端通过 src/engine/shims/register-bun-bundle.ts 设置，Electron 端没走那条路，这里显式设
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

// --- Feature flags (same as Web端) ---
const REQUIRED_FEATURES = [
  'EXTRACT_MEMORIES',
  'CONTEXT_COLLAPSE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'TRANSCRIPT_CLASSIFIER',
  'BASH_CLASSIFIER',
]
if (!process.env.CLAUDE_CODE_FEATURES) {
  process.env.CLAUDE_CODE_FEATURES = REQUIRED_FEATURES.join(',')
} else {
  const existing = new Set(process.env.CLAUDE_CODE_FEATURES.split(','))
  for (const f of REQUIRED_FEATURES) existing.add(f)
  process.env.CLAUDE_CODE_FEATURES = [...existing].filter(Boolean).join(',')
}
