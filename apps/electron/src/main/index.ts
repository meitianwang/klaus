// MUST be first — sets process.env (CLAUDE_CONFIG_DIR / CLAUDE_CODE_FEATURES /
// CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) + global MACRO before the engine module
// chain evaluates. ESM is depth-first, so deferring these to top-level code
// would land them AFTER engine modules have already cached gate decisions
// (e.g. stopHooks.ts:43 lazy-requires extractMemories based on feature()).
import './env-bootstrap.js'

import { app, nativeImage } from 'electron'
import { join } from 'path'
import { SettingsStore } from './settings-store.js'
import { EngineHost } from './engine-host.js'
import { SkillsManager } from './skills-manager.js'
import { McpConfigManager } from './mcp-config.js'
import { ConnectorManager } from './connector-manager.js'
import { ChannelConfigManager } from './channel-config.js'
import { CronScheduler } from './cron-scheduler.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { createMainWindow, getMainWindow, showMainWindow } from './window.js'
import { createTray } from './tray.js'

// Single instance lock — prevents duplicate Klaus windows when the user
// double-clicks the dock/tray icon or launches again from the shell.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
}

// env / MACRO 设置全部在 ./env-bootstrap.js 完成（必须先于 engine 模块链 evaluate）

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

// --- App lifecycle ---

let settingsStore: SettingsStore
let cronSchedulerRef: CronScheduler | null = null
export function getCronScheduler(): CronScheduler | null { return cronSchedulerRef }
let engineHost: EngineHost
let channelManager: any = null
export function getChannelManager() { return channelManager }

app.whenReady().then(async () => {
  try {
    // Dock icon (macOS, dev + packaged). 打包后 Info.plist 会读 resources/icon.icns，
    // 但 dev 下跑的是 Electron 二进制，Dock 默认显示它自带的原子 logo；主动 setIcon 让两边一致。
    if (process.platform === 'darwin' && app.dock) {
      try {
        // 用 src/renderer/logo.png（已打包进 files）而不是 resources/，
        // 避免 dev / 打包后路径不一致
        const iconPath = join(__dirname, '../../src/renderer/logo.png')
        const icon = nativeImage.createFromPath(iconPath)
        if (!icon.isEmpty()) app.dock.setIcon(icon)
      } catch (err) {
        console.warn('[Klaus] Failed to set dock icon:', err)
      }
    }

    // 1. Settings
    settingsStore = new SettingsStore()
    settingsStore.applyModelEnvOverrides()

    // 2. Managers (message persistence moved to CC engine — sessionStorage.ts)
    const skillsManager = new SkillsManager(settingsStore)
    const mcpConfig = new McpConfigManager(settingsStore)
    const connectorManager = new ConnectorManager(settingsStore)
    const channelConfig = new ChannelConfigManager(settingsStore)
    const { NotificationService } = await import('./notification-service.js')
    const notificationService = new NotificationService(settingsStore)

    // 3. Engine (persistence via CC's recordTranscript — no external store)
    engineHost = new EngineHost(settingsStore)
    engineHost.setConnectorManager(connectorManager)

    // 5. IPC — pass all managers
    registerIpcHandlers(engineHost, settingsStore, skillsManager, mcpConfig, channelConfig, connectorManager, notificationService)

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
    cronSchedulerRef = cronScheduler

    // Wire the engine's CronCreate/Delete/List tools through to Klaus's
    // SQLite store + scheduler. Without this the engine tool is disabled
    // (isKlausCronAvailable returns false), meaning an IM user who asks
    // "create a cron task for me" would have nowhere to land. SettingsStore
    // and CronScheduler both satisfy the bridge's structural interfaces.
    try {
      const { setKlausCronBridge } = await import('../engine/utils/klausCronBridge.js')
      setKlausCronBridge(settingsStore as any, cronScheduler as any)
    } catch (err) {
      console.warn('[Klaus] Failed to wire klaus cron bridge:', err)
    }

    // Restore keep-awake state from the last session (user-set toggle on the
    // Scheduled Tasks page). Defaults to off.
    try {
      if (settingsStore.getBool('cron.keep_awake', false)) {
        const { startPowerSaveBlocker } = await import('./power-saver.js')
        startPowerSaveBlocker()
      }
    } catch (err) {
      console.warn('[Klaus] keep-awake restore failed:', err)
    }

    console.log('[Klaus] Desktop app ready')

    // 10. Channel plugins — 后台启动，handler 调 chat() 也会自动等 init
    try {
      const { ChannelManager } = await import('../channels/manager.js')

      // Channel handler uses the SAME stream-event forwarder as the UI does
      // (Electron main-process forwards chat:event IPC → renderer). This is
      // the desktop-single-user simplification of the Web 端 gateway model:
      // with just one consumer (mainWindow), there's no reason to split
      // renderable events from "plain reply text". The renderer filters by
      // `event.sessionId !== currentSessionId` so only the active tab
      // animates; the rest fall through.
      const handler = async (msg: any): Promise<string | null> => {
        const sessionKey = msg.sessionKey || `channel:${msg.senderId || 'unknown'}`
        // Derive the channel id from the sessionKey prefix (every plugin
        // builds sessionKey as `${pluginId}:...`). Falls back to 'channel'
        // when the plugin didn't set one, in which case owner_id capture and
        // cron binding are both no-ops — no channelId to target.
        const channelId = String(sessionKey).split(':')[0] || ''
        const isDirect = msg.chatType === 'direct' || msg.chatType === 'private'

        // First-private-message owner claim. Desktop doesn't know "who you
        // are" in each IM network (token connects != knowing your personal
        // id), so we treat the first DM to the bot as owner. Only written
        // once — if someone else DMs first, they become owner; same trade-off
        // as OpenClaw's first-user-wins convention, documented in ui hint.
        if (channelId && msg.senderId && isDirect) {
          const key = `channel.${channelId}.owner_id`
          if (!settingsStore.get(key)) {
            settingsStore.set(key, String(msg.senderId))
            console.log(`[Klaus] Captured owner_id for ${channelId}: ${msg.senderId}`)
          }
        }

        // Stash per-session channel context so the engine's CronCreate tool
        // can bind a freshly-created task to this IM conversation without
        // each channel plugin having to plumb it through. Cleared in the
        // finally block to avoid leaking across sessions that reuse the
        // handler later.
        let cronBridge: typeof import('../engine/utils/klausCronBridge.js') | null = null
        try {
          cronBridge = await import('../engine/utils/klausCronBridge.js')
          cronBridge.setSessionChannelContext(sessionKey, {
            channelId,
            accountId: 'default',
            targetId: deriveTargetId(sessionKey, msg),
            chatType: isDirect ? 'direct' : 'group',
            senderLabel: msg.senderName ?? undefined,
          })
        } catch {}

        try {
          const reply = await engineHost.chat(sessionKey, msg.text || '', msg.media, {
            onEvent: (event) => getMainWindow()?.webContents.send('chat:event', event),
            onPermissionRequest: (req) => getMainWindow()?.webContents.send('permission:request', req),
            // Channel sessions need the renderer told about the incoming user
            // turn — UI chats already append locally in send() so they skip this.
            emitUserMessage: true,
          })
          return reply || null
        } catch (err) {
          console.warn('[Klaus] Channel handler error:', err)
          return null
        } finally {
          try { cronBridge?.clearSessionChannelContext(sessionKey) } catch {}
        }
      }

      // sessionKey formats we've seen across plugins:
      //   feishu:${open_id}                   (DM)
      //   feishu:${chat_id}:...               (group variants)
      //   telegram:${chatId}                  (DM or group — chatId == user id for DMs in Bot API)
      //   telegram:${chatId}:topic:${tid}     (forum topic)
      //   wechat:${senderId|groupId}
      // Target id for a *reply* is always the second segment — that's the
      // chat Klaus would respond into. For DMs the bot API uses senderId as
      // the conversation id, so this works uniformly.
      function deriveTargetId(sessionKey: string, msg: any): string {
        const segs = String(sessionKey).split(':')
        if (segs.length >= 2 && segs[1]) return segs[1]
        return String(msg.senderId ?? '')
      }

      // buildNotify is a no-op now — the chat:event stream already carries
      // a `done` event per turn which the renderer uses to refresh the
      // sidebar, so we don't need a separate side-channel notification.
      const notify = () => () => {}

      channelManager = new ChannelManager({
        handler,
        settingsStore,
        buildNotify: notify,
      })

      // Import and register channel plugins
      const plugins = await Promise.allSettled([
        import('../channels/feishu.js').then(m => m.feishuPlugin),
        import('../channels/dingtalk.js').then(m => m.dingtalkPlugin),
        import('../channels/wechat.js').then(m => m.wechatPlugin),
        import('../channels/wecom.js').then(m => m.wecomPlugin),
        import('../channels/qq.js').then(m => m.qqPlugin),
        import('../channels/telegram.js').then(m => m.telegramPlugin),
        import('../channels/whatsapp.js').then(m => m.whatsappPlugin),
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

      // Wire cron scheduler → channel manager BEFORE startAll(). Each
      // channel's gateway loop runs forever (`while !aborted`), so
      // `await startAll()` never returns and any code after it is dead.
      // The channelManager instance exists at this point though, so the
      // pointer is valid — channels come online asynchronously and pick
      // up cron delivery as soon as they're running.
      try {
        cronScheduler.setChannelDeliverer(channelManager)
      } catch (err) {
        console.warn('[Klaus] Failed to wire cron → channel deliverer:', err)
      }

      // Start all enabled channels (intentionally fire-and-forget — see
      // comment above). startAll() returns a promise that only resolves
      // when every channel has stopped; during normal operation it sits
      // pending for the life of the process.
      void channelManager.startAll()
      console.log('[Klaus] Channel plugins starting (runs in background)')
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
