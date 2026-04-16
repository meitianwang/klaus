import { app } from 'electron'
import { SettingsStore } from './settings-store.js'
import { EngineHost } from './engine-host.js'
import { MessageStore } from './message-store.js'
import { SkillsManager } from './skills-manager.js'
import { McpConfigManager } from './mcp-config.js'
import { ChannelConfigManager } from './channel-config.js'
import { CronScheduler } from './cron-scheduler.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { createMainWindow } from './window.js'
import { createTray } from './tray.js'

// Prevent EPIPE crashes when stdout/stderr pipe breaks (e.g. launched from sandboxed environments)
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})

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
let channelManager: any = null
export function getChannelManager() { return channelManager }

app.whenReady().then(async () => {
  try {
    // 1. Settings
    settingsStore = new SettingsStore()
    settingsStore.applyModelEnvOverrides()

    // 2. Message store
    const messageStore = new MessageStore()
    messageStore.prune()

    // 3. Managers
    const skillsManager = new SkillsManager(settingsStore)
    const mcpConfig = new McpConfigManager(settingsStore)
    const channelConfig = new ChannelConfigManager(settingsStore)

    // 4. Engine
    engineHost = new EngineHost(settingsStore)
    engineHost.setMessageStore(messageStore)

    // 5. IPC — pass all managers
    registerIpcHandlers(engineHost, settingsStore, skillsManager, mcpConfig, channelConfig)

    // 6. Window
    const mainWindow = createMainWindow()
    engineHost.setMainWindow(mainWindow)

    // 7. Tray
    createTray()

    // 8. Init engine (MCP, prompts, etc.)
    mainWindow.webContents.send('engine:status', { status: 'initializing' })
    await engineHost.init()

    // 9. AutoDream (background memory consolidation)
    try {
      const { initAutoDream } = await import('../engine/services/autoDream/autoDream.js')
      initAutoDream()
    } catch (err) {
      console.warn('[Klaus] AutoDream init failed (non-fatal):', err)
    }

    // 10. Cron scheduler
    const cronScheduler = new CronScheduler(settingsStore, engineHost)
    cronScheduler.start()

    // 11. Channel plugins — start all enabled IM channels
    try {
      const { ChannelManager } = await import('../channels/manager.js')

      // Handler: routes inbound messages to engine
      const handler = async (msg: any) => {
        const sessionKey = msg.sessionKey || `channel:${msg.senderId || 'unknown'}`
        const result = await new Promise<string | null>((resolve) => {
          engineHost.chat(sessionKey, msg.text || '', msg.media).then(() => {
            // Get last assistant message
            resolve(null) // Chat pushes events via IPC, channels get reply via outbound
          }).catch(() => resolve(null))
        })
        return result
      }

      const notify = () => () => {} // Desktop app doesn't need gateway notifications

      channelManager = new ChannelManager({
        handler,
        settingsStore,
        messageStore,
        buildNotify: notify,
      })

      // Import and register channel plugins
      const plugins = await Promise.allSettled([
        import('../channels/feishu.js').then(m => m.feishuPlugin || m.default),
        import('../channels/dingtalk.js').then(m => m.dingtalkPlugin || m.default),
        import('../channels/wechat.js').then(m => m.wechatPlugin || m.default),
        import('../channels/wecom.js').then(m => m.wecomPlugin || m.default),
        import('../channels/qq.js').then(m => m.qqPlugin || m.default),
        import('../channels/telegram.js').then(m => m.telegramPlugin || m.default),
        import('../channels/imessage.js').then(m => m.imessagePlugin || m.default),
        import('../channels/whatsapp.js').then(m => m.whatsappPlugin || m.default),
      ])

      for (const result of plugins) {
        if (result.status === 'fulfilled' && result.value) {
          try {
            channelManager.register(result.value)
          } catch (err) {
            console.warn('[Klaus] Failed to register channel plugin:', err)
          }
        }
      }

      // Start all enabled channels
      await channelManager.startAll()
      console.log('[Klaus] Channel plugins started')
    } catch (err) {
      console.warn('[Klaus] Channel plugins init failed (non-fatal):', err)
    }

    mainWindow.webContents.send('engine:status', { status: 'ready' })
    console.log('[Klaus] Desktop app ready')
  } catch (err) {
    console.error('[Klaus] Startup failed:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
  if (channelManager) {
    try { await channelManager.stopAll() } catch {}
  }
  await engineHost?.shutdown()
  settingsStore?.close()
})
