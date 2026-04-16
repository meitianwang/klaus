import { ipcMain } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type { EngineHost } from './engine-host.js'
import type { SettingsStore } from './settings-store.js'
import type { SkillsManager } from './skills-manager.js'
import type { McpConfigManager } from './mcp-config.js'
import type { ChannelConfigManager } from './channel-config.js'

export function registerIpcHandlers(
  engine: EngineHost,
  store: SettingsStore,
  skills: SkillsManager,
  mcpConfig: McpConfigManager,
  channels: ChannelConfigManager,
): void {
  // --- Chat ---
  ipcMain.handle('chat:send', async (_e, { sessionId, text, media }) => {
    engine.chat(sessionId, text, media).catch(err => {
      console.error('[IPC] chat:send error:', err)
    })
  })

  ipcMain.handle('chat:interrupt', async (_e, { sessionId }) => {
    engine.interrupt(sessionId)
  })

  ipcMain.handle('chat:upload', async (_e, { name, type, buffer }) => {
    const uploadDir = join(homedir(), '.klaus', 'uploads')
    mkdirSync(uploadDir, { recursive: true })
    const id = randomUUID()
    const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
    const filename = id + ext
    const filepath = join(uploadDir, filename)
    writeFileSync(filepath, Buffer.from(buffer))
    return { path: filepath, id, name }
  })

  // --- Sessions ---
  ipcMain.handle('session:new', async () => engine.newSession())
  ipcMain.handle('session:list', async () => engine.listSessions())
  ipcMain.handle('session:delete', async (_e, { sessionId }) => engine.deleteSession(sessionId))
  ipcMain.handle('session:rename', async (_e, { sessionId, title }) => engine.renameSession(sessionId, title))
  ipcMain.handle('session:history', async (_e, { sessionId }) => engine.getHistory(sessionId))

  // --- Settings: Models ---
  ipcMain.handle('settings:models:list', async () => store.listModels())
  ipcMain.handle('settings:models:upsert', async (_e, model) => store.upsertModel(model))
  ipcMain.handle('settings:models:default', async (_e, { id }) => store.setDefaultModel(id))
  ipcMain.handle('settings:models:delete', async (_e, { id }) => store.deleteModel(id))

  // --- Settings: Prompts ---
  ipcMain.handle('settings:prompts:list', async () => store.listPrompts())
  ipcMain.handle('settings:prompts:upsert', async (_e, prompt) => store.upsertPrompt(prompt))
  ipcMain.handle('settings:prompts:delete', async (_e, { id }) => store.deletePrompt(id))

  // --- Settings: KV ---
  ipcMain.handle('settings:kv:get', async (_e, { key }) => store.get(key))
  ipcMain.handle('settings:kv:set', async (_e, { key, value }) => store.set(key, value))

  // --- Settings: Cron ---
  ipcMain.handle('settings:cron:list', async () => store.listTasks())
  ipcMain.handle('settings:cron:upsert', async (_e, task) => store.upsertTask(task))
  ipcMain.handle('settings:cron:delete', async (_e, { id }) => store.deleteTask(id))

  // --- Permissions ---
  ipcMain.handle('permission:respond', async (_e, { requestId, decision, acceptedSuggestionIndices }) => {
    engine.resolvePermission(requestId, { decision, acceptedSuggestionIndices })
  })

  // --- MCP ---
  ipcMain.handle('mcp:reconnect', async () => {
    await engine.reconnectMcp()
  })
  ipcMain.handle('mcp:status', async () => engine.getMcpStatus())
  ipcMain.handle('mcp:list', async () => mcpConfig.list())
  ipcMain.handle('mcp:create', async (_e, input) => {
    const result = mcpConfig.create(input)
    if (result.ok) engine.reconnectMcp().catch(() => {})
    return result
  })
  ipcMain.handle('mcp:toggle', async (_e, { name, enabled }) => {
    mcpConfig.toggle(name, enabled)
    engine.reconnectMcp().catch(() => {})
  })
  ipcMain.handle('mcp:remove', async (_e, { name }) => {
    const ok = mcpConfig.remove(name)
    if (ok) engine.reconnectMcp().catch(() => {})
    return ok
  })
  ipcMain.handle('mcp:import', async (_e, { json }) => {
    const result = mcpConfig.importJson(json)
    if (result.imported.length > 0) engine.reconnectMcp().catch(() => {})
    return result
  })

  // --- Skills ---
  ipcMain.handle('skills:list', async () => skills.listAll())
  ipcMain.handle('skills:market', async () => skills.listMarket())
  ipcMain.handle('skills:install', async (_e, { name }) => skills.install(name))
  ipcMain.handle('skills:uninstall', async (_e, { name }) => skills.uninstall(name))
  ipcMain.handle('skills:toggle', async (_e, { name, enabled }) => skills.toggle(name, enabled))
  ipcMain.handle('skills:upload', async (_e, { name, buffer }) => {
    const { join } = require('path')
    const { homedir } = require('os')
    const { mkdirSync, writeFileSync } = require('fs')
    const skillsDir = join(homedir(), '.klaus', '.claude', 'skills')
    // If it's a .md file, create dir with skill name and save SKILL.md
    const isMarkdown = name.endsWith('.md')
    const skillName = isMarkdown ? name.replace(/\.md$/, '').replace(/[^a-zA-Z0-9_-]/g, '-') : name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
    const skillDir = join(skillsDir, skillName)
    mkdirSync(skillDir, { recursive: true })
    if (isMarkdown) {
      writeFileSync(join(skillDir, 'SKILL.md'), Buffer.from(buffer))
    } else {
      // Save ZIP — would need extraction, for now save raw
      writeFileSync(join(skillDir, name), Buffer.from(buffer))
    }
    return { ok: true, name: skillName }
  })

  // --- Channels ---
  ipcMain.handle('channels:list', async () => channels.list())
  ipcMain.handle('channels:connect', async (_e, { id, config }) => {
    const result = channels.connect(id, config)
    // Hot-start the channel if ChannelManager is available
    if (result.ok) {
      try {
        const { getChannelManager } = await import('./index.js')
        const mgr = getChannelManager?.()
        if (mgr) mgr.hotStart(id, 'default')
      } catch {}
    }
    return result
  })
  ipcMain.handle('channels:disconnect', async (_e, { id }) => {
    const ok = channels.disconnect(id)
    if (ok) {
      try {
        const { getChannelManager } = await import('./index.js')
        const mgr = getChannelManager?.()
        if (mgr) await mgr.stop(id)
      } catch {}
    }
    return ok
  })
}
