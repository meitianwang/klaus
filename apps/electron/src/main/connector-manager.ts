import { app } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { SettingsStore } from './settings-store.js'
import {
  CONNECTOR_CATALOG,
  type ConnectorTool,
  connectorServerName,
  parseConnectorServer,
  getConnectorById,
} from './connectors-catalog.js'

/**
 * Persistence keys in SettingsStore KV:
 *   connector:<id>:enabled             — '1' | ''   (missing = off)
 *   connector:<id>:disabled-tools      — comma-separated tool names that are
 *                                         unchecked by the user. Missing / empty
 *                                         means "all tools enabled" (default).
 *
 * Semantics: the checkbox on a tool is the permission. Checked = auto-allow
 * the tool call (no prompt). Unchecked = auto-deny. This replaces the earlier
 * per-connector 3-state policy.
 */
function keyEnabled(id: string): string { return `connector:${id}:enabled` }
function keyDisabledTools(id: string): string { return `connector:${id}:disabled-tools` }

export interface ConnectorView {
  id: string
  group: string
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  icon: string
  platform: string
  availableOnThisPlatform: boolean
  enabled: boolean
  tools: Array<ConnectorTool & { enabled: boolean }>
}

export class ConnectorManager {
  constructor(private store: SettingsStore) {}

  /** Catalog joined with user state — shaped for the UI tab */
  list(): ConnectorView[] {
    const platform = process.platform
    return CONNECTOR_CATALOG.map(e => {
      const disabled = this.getDisabledToolsSet(e.id)
      return {
        id: e.id,
        group: e.group,
        nameZh: e.nameZh,
        nameEn: e.nameEn,
        descZh: e.descZh,
        descEn: e.descEn,
        icon: e.icon,
        platform: e.platform,
        availableOnThisPlatform: e.platform === platform,
        enabled: this.isEnabled(e.id),
        tools: e.tools.map(t => ({ ...t, enabled: !disabled.has(t.name) })),
      }
    })
  }

  isEnabled(id: string): boolean {
    return this.store.get(keyEnabled(id)) === '1'
  }

  /** Turn a connector on/off. Caller should trigger engine.reconnectMcp(). */
  toggle(id: string, enabled: boolean): { ok: boolean; error?: string } {
    const entry = getConnectorById(id)
    if (!entry) return { ok: false, error: `Unknown connector: ${id}` }
    if (enabled && entry.platform !== process.platform) {
      return { ok: false, error: `Connector "${id}" is not available on ${process.platform}` }
    }
    this.store.set(keyEnabled(id), enabled ? '1' : '')
    return { ok: true }
  }

  /** Check or uncheck an individual tool. In-memory effective on next tool call. */
  setToolEnabled(id: string, toolName: string, enabled: boolean): { ok: boolean; error?: string } {
    const entry = getConnectorById(id)
    if (!entry) return { ok: false, error: `Unknown connector: ${id}` }
    if (!entry.tools.some(t => t.name === toolName)) {
      return { ok: false, error: `Unknown tool "${toolName}" on ${id}` }
    }
    const set = this.getDisabledToolsSet(id)
    if (enabled) set.delete(toolName)
    else set.add(toolName)
    this.store.set(keyDisabledTools(id), [...set].join(','))
    return { ok: true }
  }

  private getDisabledToolsSet(id: string): Set<string> {
    const raw = this.store.get(keyDisabledTools(id)) ?? ''
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
  }

  /**
   * Build MCP server configs for all enabled connectors on this platform.
   * Called by EngineHost.initMcp() — merged with user .mcp.json servers
   * in-memory (never written to disk).
   */
  buildServers(): Record<string, {
    type: 'stdio'
    command: string
    args: string[]
    env: Record<string, string>
  }> {
    const out: Record<string, { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }> = {}
    for (const entry of CONNECTOR_CATALOG) {
      if (entry.platform !== process.platform) continue
      if (!this.isEnabled(entry.id)) continue
      out[connectorServerName(entry.id)] = {
        type: 'stdio',
        command: process.execPath,
        args: [resolveScriptPath(entry.script)],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          KLAUS_CONNECTOR: entry.id,
        },
      }
    }
    return out
  }

  /**
   * Resolve permission for a connector tool call.
   *   true  — tool belongs to a connector and is checked by user → auto-allow
   *   false — tool belongs to a connector but is unchecked → auto-deny
   *   null  — not a connector tool → fall through to normal permission flow
   */
  isConnectorToolAllowed(toolName: string): boolean | null {
    const parts = toolName.split('__')
    if (parts.length < 3 || parts[0] !== 'mcp') return null
    const serverName = parts[1]!
    const id = parseConnectorServer(serverName)
    if (!id) return null
    const entry = getConnectorById(id)
    if (!entry) return null
    // Tool portion may include double-underscores if the tool name itself has them;
    // join the remaining parts back.
    const toolOnly = parts.slice(2).join('__')
    const disabled = this.getDisabledToolsSet(id)
    return !disabled.has(toolOnly)
  }
}

function resolveScriptPath(scriptName: string): string {
  const dirFromMain = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  let candidate = join(dirFromMain, '..', 'connectors', scriptName)
  if (app.isPackaged && candidate.includes(`${'app.asar'}${'/'}`)) {
    candidate = candidate.replace(`${'app.asar'}${'/'}`, `${'app.asar'}.unpacked${'/'}`)
  }
  return candidate
}
