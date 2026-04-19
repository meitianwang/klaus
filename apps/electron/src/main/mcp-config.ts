import { join, dirname } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { SettingsStore } from './settings-store.js'
import { BUILTIN_MCP_CATALOG, getBuiltinById, materializeConfig } from './mcp-builtin.js'

// MCP config file path — same as engine reads
const MCP_CONFIG_PATH = join(homedir(), '.klaus', '.mcp.json')
const MCP_CONFIG_ALT = join(homedir(), '.klaus', 'mcp.json')

interface McpJsonFile {
  mcpServers: Record<string, Record<string, unknown>>
}

export interface McpServerConfig {
  name: string
  config: Record<string, unknown>
  enabled: boolean
}

export class McpConfigManager {
  private store: SettingsStore

  constructor(store: SettingsStore) {
    this.store = store
  }

  /** List all MCP server configs from .mcp.json + enable/disable state */
  list(): McpServerConfig[] {
    const data = this.readMcpJson()
    const prefs = this.getPreferences()

    return Object.entries(data.mcpServers).map(([name, config]) => ({
      name,
      config,
      enabled: prefs.get(name) !== 'off',
    }))
  }

  /** Add a new MCP server */
  create(input: Record<string, unknown>): { ok: boolean; name: string; error?: string } {
    const { name, ...config } = input as { name?: string; [k: string]: unknown }
    if (!name) return { ok: false, name: '', error: 'name is required' }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { ok: false, name, error: 'Invalid name: only letters, numbers, hyphens, underscores' }
    }

    const data = this.readMcpJson()
    if (data.mcpServers[name]) {
      return { ok: false, name, error: `MCP server "${name}" already exists` }
    }

    data.mcpServers[name] = config
    this.writeMcpJson(data)
    this.store.set(`mcp:${name}`, 'on')
    return { ok: true, name }
  }

  /** Update an existing MCP server's config (preserves enabled state) */
  update(name: string, config: Record<string, unknown>): { ok: boolean; error?: string } {
    const data = this.readMcpJson()
    if (!data.mcpServers[name]) return { ok: false, error: `MCP server "${name}" not found` }
    data.mcpServers[name] = config
    this.writeMcpJson(data)
    return { ok: true }
  }

  /** Enable/disable an MCP server */
  toggle(name: string, enabled: boolean): void {
    this.store.set(`mcp:${name}`, enabled ? 'on' : 'off')
  }

  /** Check whether the given server name is a known built-in catalog id */
  isBuiltin(name: string): boolean {
    return BUILTIN_MCP_CATALOG.some(e => e.id === name)
  }

  /** List built-in catalog with current installed/enabled state */
  listBuiltin(): Array<{
    id: string
    nameZh: string
    nameEn: string
    descZh: string
    descEn: string
    iconSvg: string
    link: string
    auth: string
    envKeys: { key: string; label: string; secret?: boolean }[]
    installed: boolean
    enabled: boolean
  }> {
    const data = this.readMcpJson()
    const prefs = this.getPreferences()
    return BUILTIN_MCP_CATALOG.map(e => ({
      id: e.id,
      nameZh: e.nameZh,
      nameEn: e.nameEn,
      descZh: e.descZh,
      descEn: e.descEn,
      iconSvg: e.iconSvg,
      link: e.link,
      auth: e.auth,
      envKeys: e.envKeys ?? [],
      installed: !!data.mcpServers[e.id],
      enabled: !!data.mcpServers[e.id] && prefs.get(e.id) !== 'off',
    }))
  }

  /** Install a built-in server by id with user-provided env values */
  installBuiltin(
    id: string,
    envValues: Record<string, string> = {},
  ): { ok: boolean; error?: string } {
    const entry = getBuiltinById(id)
    if (!entry) return { ok: false, error: `Unknown built-in id: ${id}` }
    const data = this.readMcpJson()
    if (data.mcpServers[id]) return { ok: false, error: `Already installed: ${id}` }
    data.mcpServers[id] = materializeConfig(entry.config, envValues)
    this.writeMcpJson(data)
    this.store.set(`mcp:${id}`, 'on')
    return { ok: true }
  }

  /** Remove an MCP server */
  remove(name: string): boolean {
    const data = this.readMcpJson()
    if (!data.mcpServers[name]) return false
    delete data.mcpServers[name]
    this.writeMcpJson(data)
    this.store.set(`mcp:${name}`, '')
    return true
  }

  /** Import from JSON (multiple servers) */
  importJson(raw: string): { ok: boolean; imported: string[]; errors: string[] } {
    // Strip // comments
    const cleaned = raw.replace(/\/\/[^\n]*/g, '').trim()
    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return { ok: false, imported: [], errors: ['Invalid JSON'] }
    }

    const servers = parsed.mcpServers || parsed
    if (typeof servers !== 'object' || Array.isArray(servers)) {
      return { ok: false, imported: [], errors: ['Expected mcpServers object'] }
    }

    const data = this.readMcpJson()
    const imported: string[] = []
    const errors: string[] = []

    for (const [name, config] of Object.entries(servers)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        errors.push(`${name}: invalid name`)
        continue
      }
      if (data.mcpServers[name]) {
        errors.push(`${name}: already exists`)
        continue
      }
      data.mcpServers[name] = config as Record<string, unknown>
      this.store.set(`mcp:${name}`, 'on')
      imported.push(name)
    }

    if (imported.length > 0) {
      this.writeMcpJson(data)
    }

    return { ok: errors.length === 0, imported, errors }
  }

  private readMcpJson(): McpJsonFile {
    for (const path of [MCP_CONFIG_PATH, MCP_CONFIG_ALT]) {
      if (existsSync(path)) {
        try {
          const raw = readFileSync(path, 'utf-8')
          const parsed = JSON.parse(raw)
          return { mcpServers: parsed?.mcpServers ?? {} }
        } catch {
          continue
        }
      }
    }
    return { mcpServers: {} }
  }

  private writeMcpJson(data: McpJsonFile): void {
    mkdirSync(dirname(MCP_CONFIG_PATH), { recursive: true })
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8')
  }

  private getPreferences(): Map<string, string> {
    const map = new Map<string, string>()
    for (const [k, v] of this.store.getByPrefix('mcp:')) {
      map.set(k.slice('mcp:'.length), v)
    }
    return map
  }
}
