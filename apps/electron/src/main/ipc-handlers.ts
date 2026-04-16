import { ipcMain } from 'electron'
import type { EngineHost } from './engine-host.js'
import type { SettingsStore } from './settings-store.js'

export function registerIpcHandlers(engine: EngineHost, store: SettingsStore): void {
  // --- Chat ---
  ipcMain.handle('chat:send', async (_e, { sessionId, text, media }) => {
    // Fire and forget — events stream back via webContents.send
    engine.chat(sessionId, text, media).catch(err => {
      console.error('[IPC] chat:send error:', err)
    })
  })

  ipcMain.handle('chat:interrupt', async (_e, { sessionId }) => {
    engine.interrupt(sessionId)
  })

  // --- Sessions ---
  ipcMain.handle('session:new', async () => {
    return engine.newSession()
  })

  ipcMain.handle('session:list', async () => {
    return engine.listSessions()
  })

  ipcMain.handle('session:delete', async (_e, { sessionId }) => {
    engine.deleteSession(sessionId)
  })

  ipcMain.handle('session:rename', async (_e, { sessionId, title }) => {
    engine.renameSession(sessionId, title)
  })

  ipcMain.handle('session:history', async (_e, { sessionId }) => {
    return engine.getHistory(sessionId)
  })

  // --- Settings: Models ---
  ipcMain.handle('settings:models:list', async () => {
    return store.listModels()
  })

  ipcMain.handle('settings:models:upsert', async (_e, model) => {
    store.upsertModel(model)
  })

  ipcMain.handle('settings:models:default', async (_e, { id }) => {
    store.setDefaultModel(id)
  })

  ipcMain.handle('settings:models:delete', async (_e, { id }) => {
    return store.deleteModel(id)
  })

  // --- Settings: Prompts ---
  ipcMain.handle('settings:prompts:list', async () => {
    return store.listPrompts()
  })

  ipcMain.handle('settings:prompts:upsert', async (_e, prompt) => {
    store.upsertPrompt(prompt)
  })

  ipcMain.handle('settings:prompts:delete', async (_e, { id }) => {
    return store.deletePrompt(id)
  })

  // --- Settings: KV ---
  ipcMain.handle('settings:kv:get', async (_e, { key }) => {
    return store.get(key)
  })

  ipcMain.handle('settings:kv:set', async (_e, { key, value }) => {
    store.set(key, value)
  })

  // --- Settings: Cron ---
  ipcMain.handle('settings:cron:list', async () => {
    return store.listTasks()
  })

  ipcMain.handle('settings:cron:upsert', async (_e, task) => {
    store.upsertTask(task)
  })

  ipcMain.handle('settings:cron:delete', async (_e, { id }) => {
    return store.deleteTask(id)
  })

  // --- Permissions ---
  ipcMain.handle('permission:respond', async (_e, { requestId, decision, acceptedSuggestionIndices }) => {
    engine.resolvePermission(requestId, { decision, acceptedSuggestionIndices })
  })

  // --- MCP ---
  ipcMain.handle('mcp:reconnect', async () => {
    await engine.reconnectMcp()
  })

  ipcMain.handle('mcp:status', async () => {
    return engine.getMcpStatus()
  })
}
