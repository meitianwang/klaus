// Content for the skill-creator bundled skill.
// Uses readFileSync instead of Bun's text loader for Node.js/tsx compatibility.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readFile(relativePath: string): string {
  try {
    return readFileSync(join(__dirname, relativePath), 'utf-8')
  } catch {
    return ''
  }
}

export const SKILL_MD: string = readFile('./skill-creator/SKILL.md')

export const SKILL_FILES: Record<string, string> = {
  'agents/grader.md': readFile('./skill-creator/agents/grader.md'),
  'agents/comparator.md': readFile('./skill-creator/agents/comparator.md'),
  'agents/analyzer.md': readFile('./skill-creator/agents/analyzer.md'),
  'references/schemas.md': readFile('./skill-creator/references/schemas.md'),
  'assets/eval_review.html': readFile('./skill-creator/assets/eval_review.html'),
  'eval-viewer/generate_review.py': readFile('./skill-creator/eval-viewer/generate_review.py'),
  'eval-viewer/viewer.html': readFile('./skill-creator/eval-viewer/viewer.html'),
  'scripts/__init__.py': readFile('./skill-creator/scripts/__init__.py'),
  'scripts/aggregate_benchmark.py': readFile('./skill-creator/scripts/aggregate_benchmark.py'),
  'scripts/generate_report.py': readFile('./skill-creator/scripts/generate_report.py'),
  'scripts/improve_description.py': readFile('./skill-creator/scripts/improve_description.py'),
  'scripts/package_skill.py': readFile('./skill-creator/scripts/package_skill.py'),
  'scripts/quick_validate.py': readFile('./skill-creator/scripts/quick_validate.py'),
  'scripts/run_eval.py': readFile('./skill-creator/scripts/run_eval.py'),
  'scripts/run_loop.py': readFile('./skill-creator/scripts/run_loop.py'),
  'scripts/utils.py': readFile('./skill-creator/scripts/utils.py'),
}
