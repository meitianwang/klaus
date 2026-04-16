// Content for the verify bundled skill.
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

export const SKILL_MD: string = readMd('./verify/SKILL.md')

export const SKILL_FILES: Record<string, string> = {
  'examples/cli.md': readMd('./verify/examples/cli.md'),
  'examples/server.md': readMd('./verify/examples/server.md'),
}
