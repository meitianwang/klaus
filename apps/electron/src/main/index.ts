import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
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

// Ensure we run as Electron app, not Node.js (Claude Code sets ELECTRON_RUN_AS_NODE=1)
delete process.env.ELECTRON_RUN_AS_NODE

// 把 CC 引擎的 home 重定向到 ~/.klaus — skills / MCP / settings / permissions / user memory 全局共享到这里
// 必须在任何 engine 模块加载前设置，getClaudeConfigHomeDir() 会读这个 env
process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.klaus')
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'

// CC 引擎的 MACRO 全局 — bundle 里只有 `MACRO.VERSION` 之类的运行时引用，没有编译期替换
// Web 端通过 src/engine/shims/register-bun-bundle.ts 设置，Electron 端没走那条路，这里显式设
;(globalThis as any).MACRO = {
  VERSION: '2.1.88',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '',
  FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
  ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
  VERSION_CHANGELOG: '',
  IS_CI: false,
}

// Prevent EPIPE crashes when stdout/stderr pipe breaks
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})

// Prevent uncaught exceptions from crashing the app (e.g. channel plugin spawn failures)
process.on('uncaughtException', (err) => {
  console.error('[Klaus] Uncaught exception (non-fatal):', err.message)
})
process.on('unhandledRejection', (err: any) => {
  console.error('[Klaus] Unhandled rejection (non-fatal):', err?.message || err)
})

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
    registerIpcHandlers(engineHost, settingsStore, skillsManager, mcpConfig, channelConfig, messageStore)

    // 6. Window
    const mainWindow = createMainWindow()
    engineHost.setMainWindow(mainWindow)

    // 7. Tray
    createTray(settingsStore)

    // 8. Engine 初始化 + 依赖它的服务（AutoDream）— 全部后台进行，chat() 会自动 await init
    engineHost.init()
      .then(async () => {
        try {
          const { initAutoDream } = await import('../engine/services/autoDream/autoDream.js')
          initAutoDream()
        } catch (err) {
          console.warn('[Klaus] AutoDream init failed (non-fatal):', err)
        }
        console.log('[Klaus] Engine ready')
      })
      .catch(err => {
        console.error('[Klaus] Engine init failed:', err)
        mainWindow.webContents.send('engine:status', { status: 'error' })
      })

    // 9. Cron scheduler — chat() 内部会等 init，可立即启动
    const cronScheduler = new CronScheduler(settingsStore, engineHost)
    cronScheduler.start()

    console.log('[Klaus] Desktop app ready')

    // 10. Channel plugins — 后台启动，handler 调 chat() 也会自动等 init
    try {
      const { ChannelManager } = await import('../channels/manager.js')

      // Channel handler: intentionally does NOT pass onEvent to engine.chat() —
      // aligns with Web 端 handler at src/index.ts:132: external channels don't
      // register a stream-event forwarder, so engine events never reach the
      // desktop UI. Only the final reply text is used, delivered by the
      // channel's own outbound adapter.
      const handler = async (msg: any): Promise<string | null> => {
        const sessionKey = msg.sessionKey || `channel:${msg.senderId || 'unknown'}`
        try {
          const reply = await engineHost.chat(sessionKey, msg.text || '', msg.media)
          return reply || null
        } catch (err) {
          console.warn('[Klaus] Channel handler error:', err)
          return null
        }
      }

      // buildNotify: mirrors Web 端 src/index.ts:202. Each time a channel sinks
      // a message (role=user on inbound, role=assistant on outbound), push a
      // session-touched notification to the main window so the sidebar can
      // surface the new/updated session. This is the ONLY engine signal the
      // UI receives for external-channel activity.
      const notify = () => (sessionKey: string, role: 'user' | 'assistant', text: string) => {
        engineHost.notifySessionTouched(sessionKey, role, text)
      }

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
