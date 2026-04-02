/**
 * Scratchpad directory — adapted from claude-code's utils/permissions/filesystem.ts.
 * Provides a session-scoped temp directory that tools can freely read/write to.
 */

import { join, normalize, sep } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { getSessionId } from '../bootstrap/state.js'

// ============================================================================
// Directory
// ============================================================================

function getProjectTempDir(): string {
  return join(tmpdir(), `klaus-${process.getuid?.() ?? 0}`)
}

export function getScratchpadDir(): string {
  return join(getProjectTempDir(), getSessionId(), 'scratchpad')
}

export function ensureScratchpadDir(): string {
  const dir = getScratchpadDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

// ============================================================================
// Path checking (for permission auto-allow)
// ============================================================================

export function isScratchpadPath(absolutePath: string): boolean {
  const scratchpadDir = getScratchpadDir()
  const normalizedPath = normalize(absolutePath)
  return (
    normalizedPath === scratchpadDir ||
    normalizedPath.startsWith(scratchpadDir + sep)
  )
}

// ============================================================================
// System prompt section
// ============================================================================

export function getScratchpadInstructions(): string {
  const scratchpadDir = getScratchpadDir()
  return `# Scratchpad Directory

IMPORTANT: Always use this scratchpad directory for temporary files instead of \`/tmp\` or other system temp directories:
\`${scratchpadDir}\`

Use this directory for ALL temporary file needs:
- Storing intermediate results or data during multi-step tasks
- Writing temporary scripts or configuration files
- Saving outputs that don't belong in the user's project
- Creating working files during analysis or processing
- Any file that would otherwise go to \`/tmp\`

Only use \`/tmp\` if the user explicitly requests it.

The scratchpad directory is session-specific, isolated from the user's project, and can be used freely without permission prompts.`
}
