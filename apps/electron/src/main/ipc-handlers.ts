import { ipcMain, shell, app } from 'electron'
import { join, basename as pathBasename } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync, accessSync, constants as fsConstants } from 'fs'
import { readFile as fsReadFile, writeFile as fsWriteFile, stat as fsStat } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { getMainWindow } from './window.js'
import type { EngineHost } from './engine-host.js'
import type { SettingsStore } from './settings-store.js'
import type { SkillsManager } from './skills-manager.js'
import type { McpConfigManager } from './mcp-config.js'
import type { ChannelConfigManager } from './channel-config.js'
import type { ConnectorManager } from './connector-manager.js'
import type { NotificationService } from './notification-service.js'
import { connectorServerName } from './connectors-catalog.js'
import { openArtifactWindow } from './artifact-window.js'
import { setGateEnabled } from '../engine/services/analytics/growthbook.js'
import { clearToolSchemaCache } from '../engine/utils/toolSchemaCache.js'

// Persisted agent task snapshots — written by renderer after every
// mergeAgentTasks call (debounced). Loaded on session switch so
// previously-completed agents remain visible after app restart.
const AGENT_TASKS_DIR = join(homedir(), '.klaus', 'agent-tasks')
mkdirSync(AGENT_TASKS_DIR, { recursive: true })

export function registerIpcHandlers(
  engine: EngineHost,
  store: SettingsStore,
  skills: SkillsManager,
  mcpConfig: McpConfigManager,
  channels: ChannelConfigManager,
  connectors: ConnectorManager,
  notify: NotificationService,
): void {
  // Apply agent feature toggles at startup so env vars reflect saved user preferences.
  applyAgentFeatureEnvs(store)

  // --- Chat ---
  // Register forwarders on chat():
  // - onEvent forwards engine stream events to the renderer via 'chat:event'
  // - onPermissionRequest forwards ask prompts via 'permission:request'
  // External channels (wechat/…) call engine.chat() WITHOUT these, so their streams
  // never reach the UI — aligns with Web 端 gateway per-user event dispatch.
  ipcMain.handle('chat:send', async (_e, { sessionId, text, media }) => {
    console.log('[IPC] chat:send received', { sessionId, textLen: text?.length })
    // Persistence is fully owned by engine.chat() now — full Message objects
    // (including thinking / tool_use content blocks) are written so Cmd+R
    // restore matches the live stream. No need to re-append here.
    engine.chat(sessionId, text, media, {
      onEvent: (event) => {
        getMainWindow()?.webContents.send('chat:event', event)
        if ((event as { type?: string })?.type === 'done') notify.notifyDone()
      },
      onPermissionRequest: (req) => {
        getMainWindow()?.webContents.send('permission:request', req)
        notify.notifyNeedInput(req?.message || 'Waiting for your approval')
      },
    }).catch(err => {
      console.error('[IPC] chat:send error:', err)
    })
  })

  ipcMain.handle('chat:interrupt', async (_e, { sessionId }) => {
    engine.interrupt(sessionId)
  })

  // --- Context-window introspection (monitor-panel Context section) ---
  // Renderer only fires this between turns (after `done` / `compact_boundary`),
  // so it's fine that analyzeContextUsage walks the full message buffer.
  ipcMain.handle('engine:contextStats', async (_e, { sessionId }) => {
    if (typeof sessionId !== 'string' || !sessionId) return null
    return await engine.getContextStats(sessionId)
  })

  // --- Manual /compact (input-toolbar button) ---
  // Replicates CC's /compact slash command from outside the engine: replaces
  // the session's messages with a summary + post-compact attachments and pushes
  // compact_boundary so the renderer collapses pre-boundary DOM.
  ipcMain.handle('engine:compactSession', async (_e, { sessionId, customInstructions }) => {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: 'Invalid sessionId' }
    return await engine.compactSession(sessionId, typeof customInstructions === 'string' ? customInstructions : '')
  })

  // Truncate session transcript at a target user message — host-level splice
  // on top of CC's append-only JSONL (engine has no public "rewind to message"
  // primitive). 'rewind' = conversation cut + file-history rollback (CC's
  // /rewind semantics), and returns the deleted user text so the renderer can
  // populate the input box for editing. 'delete' = conversation cut only;
  // files on disk and the artifacts table are left untouched.
  ipcMain.handle('chat:rewind-from', async (_e, { sessionId, messageUuid }) =>
    engine.truncateAtMessage(sessionId, messageUuid, { mode: 'rewind', returnText: true }))
  ipcMain.handle('chat:delete-from', async (_e, { sessionId, messageUuid }) =>
    engine.truncateAtMessage(sessionId, messageUuid, { mode: 'delete', returnText: false }))

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
  // Desktop-UI "new chat" — each invocation produces an independent uuid.
  // The sidebar reflects whatever JSONLs actually exist on disk; deletion
  // is the user's call. Mirrors CC CLI's /clear (fresh uuid, no rotation).
  ipcMain.handle('session:new', async () => engine.newSession())
  ipcMain.handle('session:list', async () => engine.listSessions())
  ipcMain.handle('session:delete', async (_e, { sessionId, wipeWorkspace }) => engine.deleteSession(sessionId, { wipeWorkspace: !!wipeWorkspace }))
  ipcMain.handle('session:rename', async (_e, { sessionId, title }) => engine.renameSession(sessionId, title))
  ipcMain.handle('session:history', async (_e, { sessionId }) => engine.getHistory(sessionId))

  // --- Tasks (CC TaskCreate/TaskUpdate state, surfaced as a panel) ---
  // For standalone sessions taskListId === sessionId. The renderer pulls
  // the current snapshot on session open; live updates come via the
  // task_list event broadcast from the engine-host onTasksUpdated listener.
  ipcMain.handle('tasks:list', async (_e, { sessionId }) => {
    if (typeof sessionId !== 'string' || !sessionId) return { tasks: [] }
    try {
      return { tasks: await engine.readTasksForSession(sessionId) }
    } catch (err) {
      console.warn('[tasks:list] failed:', err)
      return { tasks: [] }
    }
  })

  // --- Agent / teammate task snapshot (CC BackgroundTasksDialog data feed) ---
  // Renderer calls this on session switch / cold start so the panel hydrates
  // immediately. Live updates ride the `tasks_changed` engine event.
  ipcMain.handle('agents:snapshot', async (_e, { sessionId }) => {
    if (typeof sessionId !== 'string' || !sessionId) return { tasks: {} }
    try {
      return { tasks: engine.getAgentTasksSnapshot(sessionId) }
    } catch (err) {
      console.warn('[agents:snapshot] failed:', err)
      return { tasks: {} }
    }
  })

  // Sub-agent transcript loader. Renderer switches the main chat surface to
  // a sub-agent's internal conversation when the user clicks an agent row
  // (CC's enterTeammateView). agentId is LocalAgentTaskState.agentId, sourced
  // from the panel snapshot — the engine stores sub-agent JSONL under
  // <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl.
  ipcMain.handle('agents:history', async (_e, { sessionId, agentId }) => {
    if (typeof sessionId !== 'string' || !sessionId) return { messages: [] }
    if (typeof agentId !== 'string' || !agentId) return { messages: [] }
    try {
      return { messages: await engine.getSubAgentHistory(sessionId, agentId) }
    } catch (err) {
      console.warn('[agents:history] failed:', err)
      return { messages: [] }
    }
  })

  ipcMain.handle('agents:teammate-messages', async (_e, { sessionId, taskId }) => {
    if (typeof sessionId !== 'string' || !sessionId) return { messages: [] }
    if (typeof taskId !== 'string' || !taskId) return { messages: [] }
    try {
      return { messages: await engine.getTeammateMessages(sessionId, taskId) }
    } catch (err) {
      console.warn('[agents:teammate-messages] failed:', err)
      return { messages: [] }
    }
  })

  ipcMain.handle('agents:save-tasks', async (_e, { sessionId, tasks }) => {
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) return
    try {
      const filePath = join(AGENT_TASKS_DIR, `${sessionId}.json`)
      await fsWriteFile(filePath, JSON.stringify(tasks), 'utf8')
    } catch (err) {
      console.warn('[agents:save-tasks] failed:', err)
    }
  })

  ipcMain.handle('agents:load-tasks', async (_e, { sessionId }) => {
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId)) return { tasks: {} }
    try {
      const filePath = join(AGENT_TASKS_DIR, `${sessionId}.json`)
      const raw = await fsReadFile(filePath, 'utf8')
      return { tasks: JSON.parse(raw) }
    } catch {
      return { tasks: {} }
    }
  })

  // --- Artifacts (files agent wrote during a session) ---
  ipcMain.handle('artifacts:list', async (_e, { sessionId }) => {
    const records = store.listArtifacts(sessionId)
    return {
      artifacts: records.map(r => ({
        filePath: r.filePath,
        fileName: pathBasename(r.filePath),
        lastOp: r.lastOp,
        firstSeenAt: r.firstSeenAt,
        lastModifiedAt: r.lastModifiedAt,
      })),
    }
  })
  // Read a single artifact's content for preview. Path must (1) be recorded as
  // an artifact for this session, (2) actually exist. Max 1 MiB; binary stays
  // utf-8-decoded (renderer chooses how to display).
  ipcMain.handle('artifacts:read', async (_e, { sessionId, filePath }) => {
    if (!sessionId || typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      return { error: 'invalid path' }
    }
    if (!store.getArtifact(sessionId, filePath)) {
      return { error: 'not an artifact of this session' }
    }
    try {
      const info = await fsStat(filePath)
      if (!info.isFile()) return { error: 'not a file' }
      const MAX = 1024 * 1024
      const truncated = info.size > MAX
      const buf = await fsReadFile(filePath)
      const slice = truncated ? buf.subarray(0, MAX) : buf
      return {
        filePath,
        fileName: pathBasename(filePath),
        size: info.size,
        truncated,
        content: slice.toString('utf8'),
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') return { error: 'file not found' }
      return { error: String(err) }
    }
  })

  // Open the session's workspace directory in Finder/file manager.
  ipcMain.handle('artifacts:open-workspace', async (_e, { sessionId }) => {
    if (!sessionId) return { error: 'invalid sessionId' }
    const dir = engine.getSessionDir(sessionId)
    try { mkdirSync(dir, { recursive: true }) } catch {}
    const err = await shell.openPath(dir)
    return err ? { error: err } : { ok: true, path: dir }
  })

  // Open the artifact preview as a separate native BrowserWindow with real
  // macOS traffic-light controls (titleBarStyle: 'hiddenInset').
  ipcMain.handle('artifacts:open-window', async (_e, { sessionId, filePath }) => {
    if (!sessionId || !filePath) return { error: 'invalid args' }
    openArtifactWindow(String(sessionId), String(filePath))
    return { ok: true }
  })

  // Reveal a specific file in Finder/Explorer (highlighted in its parent folder).
  ipcMain.handle('artifacts:reveal', async (_e, { filePath }) => {
    if (!filePath || typeof filePath !== 'string') return { error: 'invalid filePath' }
    try {
      accessSync(filePath, fsConstants.F_OK)
    } catch {
      return { error: 'file not found' }
    }
    shell.showItemInFolder(filePath)
    return { ok: true }
  })

  // --- Settings: Models ---
  ipcMain.handle('settings:models:list', async () => store.listModels())
  ipcMain.handle('settings:models:upsert', async (_e, model) => store.upsertModel(model))
  ipcMain.handle('settings:models:default', async (_e, { id }) => store.setDefaultModel(id))
  ipcMain.handle('settings:models:delete', async (_e, { id }) => store.deleteModel(id))

  // --- Settings: KV ---
  ipcMain.handle('settings:kv:get', async (_e, { key }) => store.get(key))
  ipcMain.handle('settings:kv:set', async (_e, { key, value }) => {
    store.set(key, value)
    if (key === 'language') {
      // Keep tray labels in sync with the user's language choice.
      const { rebuildTrayMenu } = await import('./tray.js')
      rebuildTrayMenu()
    }
  })

  // --- Agent feature toggles ---
  // Returns the three toggleable agent features as { fork, swarms, verification }.
  // Defaults: fork=true, swarms=true, verification=false.
  ipcMain.handle('agents:features:get', async () => ({
    fork: store.get('agents.fork') !== 'false',
    swarms: store.get('agents.swarms') !== 'false',
    verification: store.get('agents.verification') === 'true',
  }))
  ipcMain.handle('agents:features:set', async (_e, { key, enabled }: { key: string; enabled: boolean }) => {
    store.set(`agents.${key}`, enabled ? 'true' : 'false')
    applyAgentFeatureEnvs(store)
    return { ok: true }
  })

  // --- Settings: Cron ---
  ipcMain.handle('settings:cron:list', async () => store.listTasks())
  ipcMain.handle('settings:cron:upsert', async (_e, task) => store.upsertTask(task))
  // User-initiated delete goes through the scheduler so it can interrupt any
  // in-flight run, cascade the cron_runs rows, and drop each session's JSONL.
  // Falls back to a plain task-row delete if the scheduler isn't up yet
  // (shouldn't happen at runtime — scheduler starts during app init).
  ipcMain.handle('settings:cron:delete', async (_e, { id }) => {
    try {
      const { getCronScheduler } = await import('./index.js')
      const sched = getCronScheduler?.()
      if (sched) return await sched.deleteTaskCascade(id)
    } catch (err) {
      console.error('[IPC] cron:delete cascade failed:', err)
    }
    return { deleted: store.deleteTask(id), sessionCount: 0 }
  })

  ipcMain.handle('settings:cron:runs:list', async (_e, filters = {}) => store.listCronRuns(filters))

  ipcMain.handle('settings:cron:run:now', async (_e, { id }: { id: string }) => {
    try {
      const { getCronScheduler } = await import('./index.js')
      const sched = getCronScheduler?.()
      if (!sched) return { ok: false, error: 'scheduler not ready' }
      const result = sched.runNow(id)
      if (!result) return { ok: false, error: 'task not found or already running' }
      return { ok: true, sessionId: result.sessionId }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('settings:cron:keep-awake:get', async () => ({
    enabled: store.getBool('cron.keep_awake', false),
  }))

  ipcMain.handle('settings:cron:keep-awake:set', async (_e, { enabled }: { enabled: boolean }) => {
    store.set('cron.keep_awake', enabled ? '1' : '0')
    try {
      const { startPowerSaveBlocker, stopPowerSaveBlocker } = await import('./power-saver.js')
      if (enabled) startPowerSaveBlocker()
      else stopPowerSaveBlocker()
    } catch (err) {
      console.error('[IPC] keep-awake toggle failed:', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true }
  })

  // --- Permissions ---
  ipcMain.handle('permission:respond', async (_e, { requestId, decision, acceptedSuggestionIndices, updatedInput }) => {
    engine.resolvePermission(requestId, { decision, acceptedSuggestionIndices, updatedInput })
  })

  // --- App: launch at login ---
  ipcMain.handle('app:loginItem:get', async () => {
    try { return { enabled: app.getLoginItemSettings().openAtLogin === true } }
    catch { return { enabled: false } }
  })
  ipcMain.handle('app:loginItem:set', async (_e, { enabled }: { enabled: boolean }) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: false })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
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
  ipcMain.handle('mcp:update', async (_e, { name, config }) => {
    const result = mcpConfig.update(name, config)
    if (result.ok) engine.reconnectMcp().catch(() => {})
    return result
  })
  ipcMain.handle('mcp:revokeAuth', async (_e, { name }) => {
    const result = await engine.revokeMcpAuth(name)
    if (result.ok) engine.reconnectMcp().catch(() => {})
    return result
  })
  ipcMain.handle('mcp:builtin:list', async () => mcpConfig.listBuiltin())
  ipcMain.handle('mcp:builtin:install', async (_e, { id, env }) => {
    const result = mcpConfig.installBuiltin(id, env || {})
    if (result.ok) engine.reconnectMcp().catch(() => {})
    return result
  })

  // --- Connectors (Klaus built-in system integrations) ---
  ipcMain.handle('connectors:list', async () => connectors.list())
  ipcMain.handle('connectors:toggle', async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
    const result = connectors.toggle(id, enabled)
    if (result.ok) engine.reconnectMcp().catch(() => {})
    return result
  })
  ipcMain.handle('connectors:setToolEnabled', async (_e, { id, toolName, enabled }: { id: string; toolName: string; enabled: boolean }) => {
    return connectors.setToolEnabled(id, toolName, enabled)
  })
  ipcMain.handle('connectors:status', async () => {
    // Filter the unified MCP status down to just connector servers (klaus- prefix)
    return engine.getMcpStatus().filter(s => {
      const list = connectors.list()
      return list.some(c => s.name === connectorServerName(c.id))
    })
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

  // --- System permissions (macOS privacy settings) ---
  // 只在 macOS 上有意义；其他平台统一返回空 list，前端据此隐藏该页。
  // 4 项走 node-mac-permissions 的原生 ObjC API（和系统设置完全一致）；
  // 自动化走 AEDeterminePermissionToAutomateTarget 的 osascript 探针；
  // 通知走 ncprefs.plist 解析（Apple 没暴露 UNUserNotificationCenter 给 Node addon）。
  ipcMain.handle('system:permissions:check', async () => {
    if (process.platform !== 'darwin') {
      return { platform: process.platform, supported: false, permissions: {} }
    }

    // node-mac-permissions 2.5.0 支持：accessibility / bluetooth / calendar / camera / contacts /
    // full-disk-access / input-monitoring / location / microphone / music-library /
    // reminders / screen / speech-recognition。没有 notifications / apple-events。
    const perms = require('node-mac-permissions') as {
      getAuthStatus: (t: string) =>
        | 'not determined'
        | 'denied'
        | 'authorized'
        | 'restricted'
        | 'limited'
    }

    const toStatus = (v: string): 'granted' | 'denied' | 'unknown' => {
      if (v === 'authorized' || v === 'limited') return 'granted'
      if (v === 'denied' || v === 'restricted') return 'denied'
      return 'unknown' // 'not determined' = 从未请求过
    }

    // Automation —— AEDeterminePermissionToAutomateTarget 没封装到 node-mac-permissions；
    // 用 osascript 探 System Events：已授权静默返回 true，被拒返回 errAEEventNotPermitted，
    // 从未询问过会触发系统授权对话框（正是用户进设置页想做的事）。
    let automation: 'granted' | 'denied' | 'unknown' = 'unknown'
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          '/usr/bin/osascript',
          ['-e', 'tell application "System Events" to return true'],
          { timeout: 1500 },
          (err) => (err ? reject(err) : resolve()),
        )
      })
      automation = 'granted'
    } catch {
      automation = 'denied'
    }

    // Notifications —— 解析 ~/Library/Preferences/com.apple.ncprefs.plist 的 apps 数组。
    // flags > 0 表示用户授权过；flags === 0 表示关闭；条目不存在表示从未请求过。
    // 这是系统自己读的同一份配置文件，不是近似猜测。
    const bundleId = app.isPackaged ? 'ai.klaus.desktop' : 'com.github.Electron'
    const notification = await checkNotificationAuth(bundleId)

    return {
      platform: 'darwin',
      supported: true,
      permissions: {
        fullDiskAccess: toStatus(perms.getAuthStatus('full-disk-access')),
        screenRecording: toStatus(perms.getAuthStatus('screen')),
        accessibility: toStatus(perms.getAuthStatus('accessibility')),
        automation,
        notification,
        location: toStatus(perms.getAuthStatus('location')),
      },
    }
  })

  ipcMain.handle('system:permissions:open', async (_e, { type }: { type: string }) => {
    if (process.platform !== 'darwin') return { ok: false, error: 'unsupported platform' }
    const urls: Record<string, string> = {
      fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
      notification: 'x-apple.systempreferences:com.apple.preference.notifications',
      location: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
    }
    const url = urls[type]
    if (!url) return { ok: false, error: 'unknown permission type' }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // macOS 缓存 TCC 决定对已运行进程生效，新授权的权限必须重启 app 才能激活
  ipcMain.handle('system:restart-app', async () => {
    app.relaunch()
    app.exit(0)
  })

  // --- Klaus user auth (PKCE + klaus:// callback, talks to Klaus web server) ---
  const broadcastAuthUpdate = (user: unknown) => {
    try { getMainWindow()?.webContents.send('klausAuth:updated', { user }) }
    catch { /* window gone */ }
  }

  ipcMain.handle('klausAuth:status', async () => {
    const { getStatus, refreshMe } = await import('./klaus-auth.js')
    const s = getStatus()
    if (s.loggedIn) {
      // Active refresh — pulls latest display_name/avatar so KV seeding in
      // renderer always reflects server truth (addresses "cloud edits don't
      // show up in desktop" case). Any network error falls back silently to
      // the cached value.
      const fresh = await refreshMe()
      if (fresh) return { loggedIn: true, user: fresh }
    }
    return s
  })

  ipcMain.handle('klausAuth:login', async () => {
    try {
      const { startLogin } = await import('./klaus-auth.js')
      const auth = await startLogin()
      broadcastAuthUpdate(auth.user)
      return { ok: true, user: auth.user }
    } catch (err: any) {
      console.error('[KlausAuth] login failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('klausAuth:logout', async (_e, opts?: { wipeLocal?: boolean }) => {
    try {
      const { logout } = await import('./klaus-auth.js')
      await logout(opts)
      broadcastAuthUpdate(null)
      return { ok: true }
    } catch (err: any) {
      console.error('[KlausAuth] logout failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('klausAuth:wipeLocal', async () => {
    try {
      const { wipeLocalUserData } = await import('./klaus-auth.js')
      wipeLocalUserData()
      return { ok: true }
    } catch (err: any) {
      console.error('[KlausAuth] wipeLocal failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('klausAuth:updateProfile', async (_e, { displayName }: { displayName: string }) => {
    try {
      const { updateProfile } = await import('./klaus-auth.js')
      const user = await updateProfile(String(displayName ?? '').trim())
      if (!user) return { ok: false, error: 'update_failed' }
      broadcastAuthUpdate(user)
      return { ok: true, user }
    } catch (err: any) {
      console.error('[KlausAuth] updateProfile failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('klausAuth:uploadAvatar', async (_e, { mime, buffer }: { mime: string; buffer: ArrayBuffer }) => {
    try {
      const { uploadAvatar } = await import('./klaus-auth.js')
      const user = await uploadAvatar(mime, Buffer.from(buffer))
      if (!user) return { ok: false, error: 'upload_failed' }
      broadcastAuthUpdate(user)
      return { ok: true, user }
    } catch (err: any) {
      console.error('[KlausAuth] uploadAvatar failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // --- Auth (Claude 订阅 OAuth) ---
  ipcMain.handle('auth:status', async () => {
    try {
      const auth = await import('../engine/utils/auth.js')
      // Clear memoize + keychain cache so we always reflect the true current
      // keychain state, regardless of CLAUDE_CODE_SKIP_OAUTH or prior calls.
      auth.clearOAuthTokenCache()
      // Temporarily lift SKIP_OAUTH so the read bypasses custom-mode suppression:
      // auth:status answers "do you have a Claude subscription?" — independent of
      // which auth mode is currently active.
      const savedSkipOAuth = process.env.CLAUDE_CODE_SKIP_OAUTH
      delete process.env.CLAUDE_CODE_SKIP_OAUTH
      const tokens = auth.getClaudeAIOAuthTokens()
      // Restore SKIP_OAUTH and immediately clear the memoize cache again so
      // the cached token doesn't bleed into custom-mode calls that expect null.
      if (savedSkipOAuth !== undefined) process.env.CLAUDE_CODE_SKIP_OAUTH = savedSkipOAuth
      auth.clearOAuthTokenCache()
      if (!tokens) return { loggedIn: false }
      const account = auth.getOauthAccountInfo?.()
      return {
        loggedIn: true,
        account: account?.emailAddress ?? account?.displayName ?? 'Claude',
        subscriptionType: tokens.subscriptionType ?? null,
      }
    } catch (err: any) {
      console.error('[Auth] status error:', err)
      return { loggedIn: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('auth:login', async () => {
    console.log('[Auth] login flow starting')
    try {
      const [{ OAuthService }, authMod, oauthClient] = await Promise.all([
        import('../engine/services/oauth/index.js'),
        import('../engine/utils/auth.js'),
        import('../engine/services/oauth/client.js'),
      ])
      const svc = new OAuthService()
      const tokens = await svc.startOAuthFlow(async (_manualUrl: string) => {
        // 用默认 openBrowser 自动打开，manual URL 暂不展示给用户
      })
      const saveResult = authMod.saveOAuthTokensIfNeeded(tokens)
      if (!saveResult.success) {
        return { ok: false, error: saveResult.warning ?? 'Failed to save tokens' }
      }
      // 把账户信息也存到全局配置
      if (tokens.tokenAccount?.uuid) {
        oauthClient.storeOAuthAccountInfo({
          accountUuid: tokens.tokenAccount.uuid,
          emailAddress: tokens.tokenAccount.emailAddress ?? '',
          organizationUuid: tokens.tokenAccount.organizationUuid,
          displayName: (tokens.profile as any)?.display_name ?? (tokens.profile as any)?.displayName,
        })
      }
      authMod.clearOAuthTokenCache()
      console.log('[Auth] login success')
      return { ok: true }
    } catch (err: any) {
      console.error('[Auth] login failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('auth:logout', async () => {
    try {
      const [storage, authMod] = await Promise.all([
        import('../engine/utils/secureStorage/index.js'),
        import('../engine/utils/auth.js'),
      ])
      const s = storage.getSecureStorage()
      const data = s.read() || {}
      delete (data as any).claudeAiOauth
      s.update(data)
      authMod.clearOAuthTokenCache()
      return { ok: true }
    } catch (err: any) {
      console.error('[Auth] logout failed:', err)
      return { ok: false, error: err?.message ?? String(err) }
    }
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

  // WeChat QR login
  let wechatQrSession: { qrcode: string; qrcodeUrl: string; startedAt: number } | null = null
  ipcMain.handle('channels:wechat:qrStart', async () => {
    try {
      const { fetchQRCode, DEFAULT_BASE_URL } = await import('../channels/wechat-api.js')
      const baseUrl = store.get('channel.wechat.base_url') || DEFAULT_BASE_URL
      const qr = await fetchQRCode(baseUrl)
      wechatQrSession = { qrcode: qr.qrcode, qrcodeUrl: qr.qrcodeUrl, startedAt: Date.now() }
      const QRCode = (await import('qrcode')).default
      const qrcodeDataUrl = await QRCode.toDataURL(qr.qrcodeUrl, { width: 280, margin: 2 })
      return { ok: true, qrcodeDataUrl }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('channels:wechat:qrPoll', async () => {
    if (!wechatQrSession) return { ok: false, error: 'no active QR session' }
    try {
      const { pollQRStatus, DEFAULT_BASE_URL } = await import('../channels/wechat-api.js')
      const baseUrl = store.get('channel.wechat.base_url') || DEFAULT_BASE_URL
      const result = await pollQRStatus(baseUrl, wechatQrSession.qrcode)
      if (result.status === 'confirmed' && result.botToken && result.accountId) {
        const { encryptCred } = await import('../channels/channel-creds.js')
        store.set('channel.wechat.token', encryptCred(result.botToken))
        store.set('channel.wechat.base_url', result.baseUrl || baseUrl)
        store.set('channel.wechat.account_id', result.accountId)
        store.set('channel.wechat.enabled', '1')
        try {
          const { getChannelManager } = await import('./index.js')
          getChannelManager?.()?.hotStart('wechat', 'default')
        } catch {}
        wechatQrSession = null
        return { ok: true, status: 'confirmed', accountId: result.accountId }
      }
      return { ok: true, status: result.status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // WhatsApp QR login
  ipcMain.handle('channels:whatsapp:start', async () => {
    store.set('channel.whatsapp.enabled', '1')
    try {
      const { getChannelManager } = await import('./index.js')
      getChannelManager?.()?.hotStart('whatsapp', 'default')
    } catch {}

    const { getWhatsAppQrStatus } = await import('../channels/whatsapp.js')
    const QRCode = (await import('qrcode')).default
    let waited = 0
    while (waited < 10000) {
      const s = getWhatsAppQrStatus()
      if (s.connected) return { ok: true, status: 'connected' }
      if (s.qr) {
        const qrcodeDataUrl = await QRCode.toDataURL(s.qr, { width: 280 })
        return { ok: true, status: 'qr', qrcodeDataUrl }
      }
      await new Promise(r => setTimeout(r, 500))
      waited += 500
    }
    return { ok: true, status: 'waiting' }
  })
  ipcMain.handle('channels:whatsapp:poll', async () => {
    const { getWhatsAppQrStatus } = await import('../channels/whatsapp.js')
    const QRCode = (await import('qrcode')).default
    const s = getWhatsAppQrStatus()
    if (s.connected) return { ok: true, status: 'connected' }
    if (s.qr) {
      const qrcodeDataUrl = await QRCode.toDataURL(s.qr, { width: 280 })
      return { ok: true, status: 'qr', qrcodeDataUrl }
    }
    return { ok: true, status: 'waiting' }
  })

}

// Apply agent feature toggles to process.env so CC engine sees the correct values.
// Called once at startup and again after each agents:features:set IPC.
// Fork and Swarms default ON; Verification defaults OFF.
export function applyAgentFeatureEnvs(store: SettingsStore): void {
  const features = new Set((process.env.CLAUDE_CODE_FEATURES ?? '').split(',').filter(Boolean))

  if (store.get('agents.fork') !== 'false') features.add('FORK_SUBAGENT')
  else features.delete('FORK_SUBAGENT')

  const verificationOn = store.get('agents.verification') === 'true'
  if (verificationOn) {
    features.add('VERIFICATION_AGENT')
  } else {
    features.delete('VERIFICATION_AGENT')
  }
  // Sync growthbook gate — verification requires both CLAUDE_CODE_FEATURES flag
  // AND tengu_hive_evidence gate (dual-gate requirement in builtInAgents.ts)
  setGateEnabled('tengu_hive_evidence', verificationOn)

  process.env.CLAUDE_CODE_FEATURES = [...features].join(',')

  if (store.get('agents.swarms') !== 'false') process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  else delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS

  // Bust the tool-schema cache so the next conversation's tool.prompt() call
  // re-evaluates isForkSubagentEnabled() / isAgentSwarmsEnabled() and produces
  // a description that matches the new feature flags.
  clearToolSchemaCache()
  console.log('[Klaus] agent features applied — CLAUDE_CODE_FEATURES:', process.env.CLAUDE_CODE_FEATURES, '| AGENT_TEAMS:', process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ?? 'off')
}

// 通知授权探测 —— 解析 ~/Library/Preferences/com.apple.ncprefs.plist 的 apps 数组。
// macOS 的 "通知中心" 首选项就是读这份文件；flags 字段是位掩码，flags > 0 代表允许，
// flags === 0 代表关闭。条目不存在说明 app 从未请求过通知权限。
async function checkNotificationAuth(bundleId: string): Promise<'granted' | 'denied' | 'unknown'> {
  const plistPath = join(homedir(), 'Library/Preferences/com.apple.ncprefs.plist')
  try {
    accessSync(plistPath, fsConstants.R_OK)
  } catch {
    return 'unknown'
  }
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', plistPath],
        { timeout: 2500, maxBuffer: 4 * 1024 * 1024 },
        (err, so) => (err ? reject(err) : resolve(so)),
      )
    })
    const data = JSON.parse(stdout)
    const apps: Array<Record<string, any>> = Array.isArray(data?.apps) ? data.apps : []
    const entry = apps.find(a => a?.['bundle-id'] === bundleId)
    if (!entry) return 'unknown'
    const flags = typeof entry.flags === 'number' ? entry.flags : 0
    return flags > 0 ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}
