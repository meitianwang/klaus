import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, readdirSync, readFileSync, existsSync, cpSync, rmSync } from 'fs'
import { app } from 'electron'
import type { SettingsStore } from './settings-store.js'

const SKILLS_DIR = join(homedir(), '.klaus', '.claude', 'skills')

// skills-market/ lives at the repo root in dev; gets copied to Resources/ in
// production via electron-builder's `extraResources`. process.cwd() is NOT
// reliable — in dev it's apps/electron/, in prod it's the app bundle's Contents/.
const SKILLS_MARKET_DIR = (() => {
  if (app?.isPackaged) return join(process.resourcesPath, 'skills-market')
  // Dev: __dirname is apps/electron/dist/main/, walk up 4 levels to repo root
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'skills-market'),
    join(process.cwd(), '..', '..', 'skills-market'),
    join(process.cwd(), 'skills-market'),
  ]
  return candidates.find(p => existsSync(p)) || candidates[0]!
})()

export interface SkillInfo {
  name: string
  description: string
  source: 'installed' | 'builtin' | 'market'
  userInvocable: boolean
  userEnabled: boolean
  installed: boolean
  dirName: string
  emoji?: string
}

export class SkillsManager {
  private store: SettingsStore

  constructor(store: SettingsStore) {
    this.store = store
    mkdirSync(SKILLS_DIR, { recursive: true })
  }

  /** List all skills (installed + market) with enable/disable state */
  listAll(): SkillInfo[] {
    const results: SkillInfo[] = []
    const prefMap = this.getPreferences()

    // Installed skills
    if (existsSync(SKILLS_DIR)) {
      for (const dir of safeReaddir(SKILLS_DIR)) {
        const skillPath = join(SKILLS_DIR, dir)
        const meta = readSkillMd(skillPath)
        const enabled = prefMap.get(dir) !== 'off'
        results.push({
          name: meta.name || dir,
          description: meta.description || '',
          source: 'installed',
          userInvocable: true,
          userEnabled: enabled,
          installed: true,
          dirName: dir,
          emoji: meta.emoji,
        })
      }
    }

    return results
  }

  /** List marketplace skills */
  listMarket(): SkillInfo[] {
    if (!existsSync(SKILLS_MARKET_DIR)) return []
    const installed = new Set(safeReaddir(SKILLS_DIR))
    const results: SkillInfo[] = []

    for (const dir of safeReaddir(SKILLS_MARKET_DIR)) {
      const skillPath = join(SKILLS_MARKET_DIR, dir)
      const meta = readSkillMd(skillPath)
      results.push({
        name: meta.name || dir,
        description: meta.description || '',
        source: 'market',
        userInvocable: true,
        userEnabled: false,
        installed: installed.has(dir),
        dirName: dir,
        emoji: meta.emoji,
      })
    }

    return results
  }

  /** Install skill from marketplace */
  install(dirName: string): { ok: boolean; name: string; error?: string } {
    const src = join(SKILLS_MARKET_DIR, dirName)
    if (!existsSync(src)) return { ok: false, name: dirName, error: 'Skill not found in marketplace' }

    const dest = join(SKILLS_DIR, dirName)
    try {
      cpSync(src, dest, { recursive: true })
      this.store.set(`skill:${dirName}`, JSON.stringify({ enabled: true }))
      return { ok: true, name: dirName }
    } catch (err: any) {
      return { ok: false, name: dirName, error: err.message }
    }
  }

  /** Uninstall user-installed skill */
  uninstall(dirName: string): boolean {
    const skillPath = join(SKILLS_DIR, dirName)
    if (!existsSync(skillPath)) return false
    rmSync(skillPath, { recursive: true, force: true })
    this.store.set(`skill:${dirName}`, '')
    return true
  }

  /** Enable/disable a skill */
  toggle(name: string, enabled: boolean): void {
    const current = this.store.getSkillSettings().get(name) ?? {}
    this.store.set(`skill:${name}`, JSON.stringify({ ...current, enabled }))
  }

  private getPreferences(): Map<string, string> {
    const map = new Map<string, string>()
    for (const [k, v] of this.store.getByPrefix('skill:')) {
      const name = k.slice('skill:'.length)
      try {
        const parsed = JSON.parse(v)
        map.set(name, parsed.enabled === false ? 'off' : 'on')
      } catch {
        map.set(name, v === 'off' ? 'off' : 'on')
      }
    }
    return map
  }
}

function readSkillMd(dir: string): { name?: string; description?: string; emoji?: string } {
  const mdPath = join(dir, 'SKILL.md')
  if (!existsSync(mdPath)) return {}
  try {
    const content = readFileSync(mdPath, 'utf-8')
    return parseSkillFrontmatter(content)
  } catch {
    return {}
  }
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string; emoji?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const frontmatter = match[1]!
  const result: { name?: string; description?: string; emoji?: string } = {}
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  if (nameMatch) result.name = nameMatch[1]!.trim().replace(/^['"]|['"]$/g, '')
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (descMatch) result.description = descMatch[1]!.trim().replace(/^['"]|['"]$/g, '')
  // Pluck emoji from embedded JSON in `metadata: { "klaus": { "emoji": "🐙", ... } }`
  const emojiMatch = frontmatter.match(/"emoji"\s*:\s*"([^"]+)"/)
  if (emojiMatch) result.emoji = emojiMatch[1]
  return result
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return []
  }
}
