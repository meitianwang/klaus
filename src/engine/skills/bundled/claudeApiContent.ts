// Content for the claude-api bundled skill.
// Uses readFileSync instead of Bun's text loader for Node.js/tsx compatibility.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readMd(relativePath: string): string {
  try {
    return readFileSync(join(__dirname, relativePath), 'utf-8')
  } catch {
    return ''
  }
}

// @[MODEL LAUNCH]: Update the model IDs/names below.
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'claude-opus-4-6',
  OPUS_NAME: 'Claude Opus 4.6',
  SONNET_ID: 'claude-sonnet-4-6',
  SONNET_NAME: 'Claude Sonnet 4.6',
  HAIKU_ID: 'claude-haiku-4-5',
  HAIKU_NAME: 'Claude Haiku 4.5',
  PREV_SONNET_ID: 'claude-sonnet-4-5',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = readMd('./claude-api/SKILL.md')

export const SKILL_FILES: Record<string, string> = {
  'csharp/claude-api.md': readMd('./claude-api/csharp/claude-api.md'),
  'curl/examples.md': readMd('./claude-api/curl/examples.md'),
  'go/claude-api.md': readMd('./claude-api/go/claude-api.md'),
  'java/claude-api.md': readMd('./claude-api/java/claude-api.md'),
  'php/claude-api.md': readMd('./claude-api/php/claude-api.md'),
  'python/agent-sdk/README.md': readMd('./claude-api/python/agent-sdk/README.md'),
  'python/agent-sdk/patterns.md': readMd('./claude-api/python/agent-sdk/patterns.md'),
  'python/claude-api/README.md': readMd('./claude-api/python/claude-api/README.md'),
  'python/claude-api/batches.md': readMd('./claude-api/python/claude-api/batches.md'),
  'python/claude-api/files-api.md': readMd('./claude-api/python/claude-api/files-api.md'),
  'python/claude-api/streaming.md': readMd('./claude-api/python/claude-api/streaming.md'),
  'python/claude-api/tool-use.md': readMd('./claude-api/python/claude-api/tool-use.md'),
  'ruby/claude-api.md': readMd('./claude-api/ruby/claude-api.md'),
  'shared/error-codes.md': readMd('./claude-api/shared/error-codes.md'),
  'shared/live-sources.md': readMd('./claude-api/shared/live-sources.md'),
  'shared/models.md': readMd('./claude-api/shared/models.md'),
  'shared/prompt-caching.md': readMd('./claude-api/shared/prompt-caching.md'),
  'shared/tool-use-concepts.md': readMd('./claude-api/shared/tool-use-concepts.md'),
  'typescript/agent-sdk/README.md': readMd('./claude-api/typescript/agent-sdk/README.md'),
  'typescript/agent-sdk/patterns.md': readMd('./claude-api/typescript/agent-sdk/patterns.md'),
  'typescript/claude-api/README.md': readMd('./claude-api/typescript/claude-api/README.md'),
  'typescript/claude-api/batches.md': readMd('./claude-api/typescript/claude-api/batches.md'),
  'typescript/claude-api/files-api.md': readMd('./claude-api/typescript/claude-api/files-api.md'),
  'typescript/claude-api/streaming.md': readMd('./claude-api/typescript/claude-api/streaming.md'),
  'typescript/claude-api/tool-use.md': readMd('./claude-api/typescript/claude-api/tool-use.md'),
}
