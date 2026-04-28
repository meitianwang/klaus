import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('klaus', {
  // Chat
  chat: {
    send: (sessionId: string, text: string, media?: any[]) => {
      console.log('[preload] chat.send invoked', { sessionId, textLen: text?.length })
      return ipcRenderer.invoke('chat:send', { sessionId, text, media })
        .then((r) => { console.log('[preload] chat.send resolved'); return r })
        .catch((e) => { console.error('[preload] chat.send ERROR', e); throw e })
    },
    interrupt: (sessionId: string) =>
      ipcRenderer.invoke('chat:interrupt', { sessionId }),
    uploadFile: (name: string, type: string, buffer: ArrayBuffer) =>
      ipcRenderer.invoke('chat:upload', { name, type, buffer }),
  },

  // Sessions
  session: {
    new: () => ipcRenderer.invoke('session:new'),
    list: () => ipcRenderer.invoke('session:list'),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', { sessionId }),
    rename: (sessionId: string, title: string) => ipcRenderer.invoke('session:rename', { sessionId, title }),
    history: (sessionId: string) => ipcRenderer.invoke('session:history', { sessionId }),
  },

  // Artifacts (files agent wrote during a session)
  artifacts: {
    list: (sessionId: string) => ipcRenderer.invoke('artifacts:list', { sessionId }),
    read: (sessionId: string, filePath: string) => ipcRenderer.invoke('artifacts:read', { sessionId, filePath }),
    openWorkspace: (sessionId: string) => ipcRenderer.invoke('artifacts:open-workspace', { sessionId }),
  },

  // Settings
  settings: {
    models: {
      list: () => ipcRenderer.invoke('settings:models:list'),
      upsert: (model: any) => ipcRenderer.invoke('settings:models:upsert', model),
      setDefault: (id: string) => ipcRenderer.invoke('settings:models:default', { id }),
      delete: (id: string) => ipcRenderer.invoke('settings:models:delete', { id }),
    },
    kv: {
      get: (key: string) => ipcRenderer.invoke('settings:kv:get', { key }),
      set: (key: string, value: string) => ipcRenderer.invoke('settings:kv:set', { key, value }),
    },
    cron: {
      list: () => ipcRenderer.invoke('settings:cron:list'),
      upsert: (task: any) => ipcRenderer.invoke('settings:cron:upsert', task),
      delete: (id: string) => ipcRenderer.invoke('settings:cron:delete', { id }),
      runs: (filters?: { limit?: number; offset?: number; taskId?: string; status?: string }) =>
        ipcRenderer.invoke('settings:cron:runs:list', filters ?? {}),
      runNow: (id: string) => ipcRenderer.invoke('settings:cron:run:now', { id }),
      keepAwake: {
        get: () => ipcRenderer.invoke('settings:cron:keep-awake:get'),
        set: (enabled: boolean) => ipcRenderer.invoke('settings:cron:keep-awake:set', { enabled }),
      },
    },
  },

  // App lifecycle
  app: {
    loginItem: {
      get: () => ipcRenderer.invoke('app:loginItem:get'),
      set: (enabled: boolean) => ipcRenderer.invoke('app:loginItem:set', { enabled }),
    },
  },

  // Permission response
  permission: {
    respond: (
      requestId: string,
      decision: 'allow' | 'deny',
      acceptedSuggestionIndices?: number[],
      updatedInput?: Record<string, unknown>,
    ) =>
      ipcRenderer.invoke('permission:respond', { requestId, decision, acceptedSuggestionIndices, updatedInput }),
  },

  // System-level privacy permissions (macOS only)
  systemPermissions: {
    check: () => ipcRenderer.invoke('system:permissions:check'),
    openSettings: (type: string) => ipcRenderer.invoke('system:permissions:open', { type }),
    restartApp: () => ipcRenderer.invoke('system:restart-app'),
  },

  // MCP
  mcp: {
    reconnect: () => ipcRenderer.invoke('mcp:reconnect'),
    status: () => ipcRenderer.invoke('mcp:status'),
    list: () => ipcRenderer.invoke('mcp:list'),
    create: (input: any) => ipcRenderer.invoke('mcp:create', input),
    update: (name: string, config: any) => ipcRenderer.invoke('mcp:update', { name, config }),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle', { name, enabled }),
    remove: (name: string) => ipcRenderer.invoke('mcp:remove', { name }),
    importJson: (json: string) => ipcRenderer.invoke('mcp:import', { json }),
    revokeAuth: (name: string) => ipcRenderer.invoke('mcp:revokeAuth', { name }),
    builtinList: () => ipcRenderer.invoke('mcp:builtin:list'),
    builtinInstall: (id: string, env: Record<string, string>) =>
      ipcRenderer.invoke('mcp:builtin:install', { id, env }),
  },

  // Connectors (Klaus built-in system integrations)
  connectors: {
    list: () => ipcRenderer.invoke('connectors:list'),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('connectors:toggle', { id, enabled }),
    setToolEnabled: (id: string, toolName: string, enabled: boolean) =>
      ipcRenderer.invoke('connectors:setToolEnabled', { id, toolName, enabled }),
    status: () => ipcRenderer.invoke('connectors:status'),
  },

  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    market: () => ipcRenderer.invoke('skills:market'),
    install: (name: string) => ipcRenderer.invoke('skills:install', { name }),
    uninstall: (name: string) => ipcRenderer.invoke('skills:uninstall', { name }),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('skills:toggle', { name, enabled }),
    upload: (name: string, buffer: ArrayBuffer) => ipcRenderer.invoke('skills:upload', { name, buffer }),
  },

  // Auth (Claude 订阅登录)
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },

  // Klaus 用户登录（PKCE + loopback 回调，对接 Klaus web server）
  klausAuth: {
    status: () => ipcRenderer.invoke('klausAuth:status'),
    login: () => ipcRenderer.invoke('klausAuth:login'),
    logout: () => ipcRenderer.invoke('klausAuth:logout'),
    updateProfile: (displayName: string) =>
      ipcRenderer.invoke('klausAuth:updateProfile', { displayName }),
    uploadAvatar: (mime: string, buffer: ArrayBuffer) =>
      ipcRenderer.invoke('klausAuth:uploadAvatar', { mime, buffer }),
  },

  // Channels
  channels: {
    list: () => ipcRenderer.invoke('channels:list'),
    connect: (id: string, config: any) => ipcRenderer.invoke('channels:connect', { id, config }),
    disconnect: (id: string) => ipcRenderer.invoke('channels:disconnect', { id }),
    wechatQrStart: () => ipcRenderer.invoke('channels:wechat:qrStart'),
    wechatQrPoll: () => ipcRenderer.invoke('channels:wechat:qrPoll'),
    whatsappStart: () => ipcRenderer.invoke('channels:whatsapp:start'),
    whatsappPoll: () => ipcRenderer.invoke('channels:whatsapp:poll'),
  },

  // Event listeners (main → renderer push)
  on: {
    chatEvent: (cb: (event: any) => void) => {
      ipcRenderer.on('chat:event', (_e, event) => cb(event))
    },
    permissionRequest: (cb: (req: any) => void) => {
      ipcRenderer.on('permission:request', (_e, req) => cb(req))
    },
    engineStatus: (cb: (status: any) => void) => {
      ipcRenderer.on('engine:status', (_e, status) => cb(status))
    },
    notifySound: (cb: (kind: 'done' | 'input') => void) => {
      ipcRenderer.on('notify:sound', (_e, kind) => cb(kind))
    },
    trayNewChat: (cb: () => void) => {
      ipcRenderer.on('tray:new-chat', () => cb())
    },
    trayOpenSettings: (cb: () => void) => {
      ipcRenderer.on('tray:open-settings', () => cb())
    },
    klausAuthUpdated: (cb: (payload: { user: any }) => void) => {
      ipcRenderer.on('klausAuth:updated', (_e, payload) => cb(payload))
    },
  },
})
