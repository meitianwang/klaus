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

  // Settings
  settings: {
    models: {
      list: () => ipcRenderer.invoke('settings:models:list'),
      upsert: (model: any) => ipcRenderer.invoke('settings:models:upsert', model),
      setDefault: (id: string) => ipcRenderer.invoke('settings:models:default', { id }),
      delete: (id: string) => ipcRenderer.invoke('settings:models:delete', { id }),
    },
    prompts: {
      list: () => ipcRenderer.invoke('settings:prompts:list'),
      upsert: (prompt: any) => ipcRenderer.invoke('settings:prompts:upsert', prompt),
      delete: (id: string) => ipcRenderer.invoke('settings:prompts:delete', { id }),
      sections: () => ipcRenderer.invoke('settings:prompts:sections'),
    },
    kv: {
      get: (key: string) => ipcRenderer.invoke('settings:kv:get', { key }),
      set: (key: string, value: string) => ipcRenderer.invoke('settings:kv:set', { key, value }),
    },
    cron: {
      list: () => ipcRenderer.invoke('settings:cron:list'),
      upsert: (task: any) => ipcRenderer.invoke('settings:cron:upsert', task),
      delete: (id: string) => ipcRenderer.invoke('settings:cron:delete', { id }),
    },
  },

  // Permission response
  permission: {
    respond: (requestId: string, decision: 'allow' | 'deny', acceptedSuggestionIndices?: number[]) =>
      ipcRenderer.invoke('permission:respond', { requestId, decision, acceptedSuggestionIndices }),
  },

  // MCP
  mcp: {
    reconnect: () => ipcRenderer.invoke('mcp:reconnect'),
    status: () => ipcRenderer.invoke('mcp:status'),
    list: () => ipcRenderer.invoke('mcp:list'),
    create: (input: any) => ipcRenderer.invoke('mcp:create', input),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('mcp:toggle', { name, enabled }),
    remove: (name: string) => ipcRenderer.invoke('mcp:remove', { name }),
    importJson: (json: string) => ipcRenderer.invoke('mcp:import', { json }),
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

  // Channels
  channels: {
    list: () => ipcRenderer.invoke('channels:list'),
    connect: (id: string, config: any) => ipcRenderer.invoke('channels:connect', { id, config }),
    disconnect: (id: string) => ipcRenderer.invoke('channels:disconnect', { id }),
    wechatQrStart: () => ipcRenderer.invoke('channels:wechat:qrStart'),
    wechatQrPoll: () => ipcRenderer.invoke('channels:wechat:qrPoll'),
    whatsappStart: () => ipcRenderer.invoke('channels:whatsapp:start'),
    whatsappPoll: () => ipcRenderer.invoke('channels:whatsapp:poll'),
    imessageInstall: () => ipcRenderer.invoke('channels:imessage:install'),
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
    trayNewChat: (cb: () => void) => {
      ipcRenderer.on('tray:new-chat', () => cb())
    },
    trayOpenSettings: (cb: () => void) => {
      ipcRenderer.on('tray:open-settings', () => cb())
    },
  },
})
