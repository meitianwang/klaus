import { app } from 'electron'
import { SettingsStore } from './settings-store.js'
import { EngineHost } from './engine-host.js'
import { MessageStore } from './message-store.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { createMainWindow } from './window.js'
import { createTray } from './tray.js'

// --- Feature flags (same as Web端) ---
if (!process.env.CLAUDE_CODE_FEATURES) {
  process.env.CLAUDE_CODE_FEATURES = [
    'EXTRACT_MEMORIES',
    'CONTEXT_COLLAPSE',
    'BUILTIN_EXPLORE_PLAN_AGENTS',
    'TRANSCRIPT_CLASSIFIER',
    'BASH_CLASSIFIER',
  ].join(',')
} else {
  const existing = new Set(process.env.CLAUDE_CODE_FEATURES.split(','))
  for (const f of ['EXTRACT_MEMORIES', 'CONTEXT_COLLAPSE', 'BUILTIN_EXPLORE_PLAN_AGENTS', 'TRANSCRIPT_CLASSIFIER', 'BASH_CLASSIFIER']) {
    existing.add(f)
  }
  process.env.CLAUDE_CODE_FEATURES = [...existing].filter(Boolean).join(',')
}

// --- App lifecycle ---

let settingsStore: SettingsStore
let engineHost: EngineHost

app.whenReady().then(async () => {
  try {
    // 1. Settings
    settingsStore = new SettingsStore()
    settingsStore.applyModelEnvOverrides()

    // 2. Message store
    const messageStore = new MessageStore()
    messageStore.prune()

    // 3. Engine
    engineHost = new EngineHost(settingsStore)
    engineHost.setMessageStore(messageStore)

    // 4. IPC
    registerIpcHandlers(engineHost, settingsStore)

    // 5. Window
    const mainWindow = createMainWindow()
    engineHost.setMainWindow(mainWindow)

    // 5. Tray
    createTray()

    // 7. Init engine (MCP, prompts, etc.)
    mainWindow.webContents.send('engine:status', { status: 'initializing' })
    await engineHost.init()

    // 8. AutoDream (background memory consolidation)
    try {
      const { initAutoDream } = await import('../engine/services/autoDream/autoDream.js')
      initAutoDream()
    } catch (err) {
      console.warn('[Klaus] AutoDream init failed (non-fatal):', err)
    }

    mainWindow.webContents.send('engine:status', { status: 'ready' })

    console.log('[Klaus] Desktop app ready')
  } catch (err) {
    console.error('[Klaus] Startup failed:', err)
  }
})

app.on('window-all-closed', () => {
  // macOS: keep running in tray
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  import('./window.js').then(({ getMainWindow: getWin }) => {
    if (!getWin()) {
      const mainWindow = createMainWindow()
      engineHost?.setMainWindow(mainWindow)
    }
  })
})

app.on('before-quit', async () => {
  await engineHost?.shutdown()
  settingsStore?.close()
})
