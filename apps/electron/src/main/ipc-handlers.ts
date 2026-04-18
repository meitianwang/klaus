import { ipcMain } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { getMainWindow } from './window.js'
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
      onEvent: (event) => getMainWindow()?.webContents.send('chat:event', event),
      onPermissionRequest: (req) => getMainWindow()?.webContents.send('permission:request', req),
    }).catch(err => {
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
  // Desktop-UI "new chat" always rotates the same channelKey `app:local`, so
  // the sidebar shows exactly one live UI session (plus archived uuids the
  // user rotated away from) rather than accumulating app:<random> entries.
  ipcMain.handle('session:new', async () => engine.newSession('app:local'))
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
  // 返回 section meta + 当前数据库存的 content，前端按 type 分组展示
  ipcMain.handle('settings:prompts:sections', async () => {
    const { OFFICIAL_STATIC_SECTIONS, OFFICIAL_DYNAMIC_SECTIONS } = await import('./engine-host.js')
    const byId = new Map(store.listPrompts().map(p => [p.id, p]))
    const staticIds = new Set(OFFICIAL_STATIC_SECTIONS.map((s: any) => s.id))
    const dynamicIds = new Set(OFFICIAL_DYNAMIC_SECTIONS.map((s: any) => s.id))

    const staticList = OFFICIAL_STATIC_SECTIONS.map((sec: any) => {
      const rec = byId.get(sec.id)
      const defaultText = (() => { try { return sec.defaultText() ?? '' } catch { return '' } })()
      return {
        type: 'static',
        id: sec.id,
        name: sec.name,
        content: rec?.content ?? '',
        defaultText,
      }
    })
    const dynamicList = OFFICIAL_DYNAMIC_SECTIONS.map((sec: any) => ({
      type: 'dynamic',
      id: sec.id,
      name: sec.name,
      desc: sec.desc,
    }))
    const customList = store.listPrompts()
      .filter(p => !staticIds.has(p.id) && !dynamicIds.has(p.id))
      .map(p => ({ type: 'custom', id: p.id, name: p.name, content: p.content }))
    return { static: staticList, dynamic: dynamicList, custom: customList }
  })

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

  // --- Auth (Claude 订阅 OAuth) ---
  ipcMain.handle('auth:status', async () => {
    try {
      const auth = await import('../engine/utils/auth.js')
      const tokens = auth.getClaudeAIOAuthTokens()
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

  // iMessage auto-install + probe
  ipcMain.handle('channels:imessage:install', async () => {
    try {
      const { execFile, exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(execFile)
      const execAsync = promisify(exec)
      const cliPath = 'imsg'

      let installed = false
      try {
        await execFileAsync(cliPath, ['--version'], { timeout: 5000 })
        installed = true
      } catch {}

      if (!installed) {
        try {
          await execFileAsync('brew', ['--version'], { timeout: 5000 })
        } catch {
          return { ok: false, error: 'Homebrew not installed. Install from https://brew.sh first.' }
        }
        try {
          await execAsync('brew install steipete/tap/imsg', { timeout: 300_000 })
        } catch (err) {
          return { ok: false, error: `imsg installation failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}` }
        }
        try {
          await execFileAsync(cliPath, ['--version'], { timeout: 5000 })
        } catch {
          return { ok: false, error: 'imsg installed but not found on PATH' }
        }
      }

      let needsFullDiskAccess = false
      try {
        await execFileAsync(cliPath, ['chats', '--limit', '1'], { timeout: 10_000 })
      } catch {
        needsFullDiskAccess = true
      }

      store.set('channel.imessage.cli_path', cliPath)
      store.set('channel.imessage.enabled', '1')
      try {
        const { getChannelManager } = await import('./index.js')
        getChannelManager?.()?.hotStart('imessage', 'default')
      } catch {}

      return {
        ok: true,
        needsFullDiskAccess,
        message: needsFullDiskAccess
          ? 'imsg installed. Grant Full Disk Access to your terminal in System Settings → Privacy & Security.'
          : 'imsg connected.',
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
