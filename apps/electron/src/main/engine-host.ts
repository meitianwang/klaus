import { randomUUID } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import type { BrowserWindow } from 'electron'
import type { SettingsStore } from './settings-store.js'
import type { MessageStore } from './message-store.js'
import type { EngineEvent, PermissionRequest, PermissionResponse, SessionInfo, ChatMessage } from '../shared/types.js'

// Engine imports — from the copied engine source
import {
  query,
  type QueryParams,
  type Message,
  type AssistantMessage,
  type ToolUseContext,
  type ToolPermissionContext,
  getEmptyToolPermissionContext,
  clearSystemPromptSections,
} from '../engine/index.js'
import { createCanUseTool, type OnAskCallback } from '../engine/hooks/useCanUseTool.js'
import { getAllBaseTools } from '../engine/tools.js'
import { getSystemPrompt } from '../engine/constants/prompts.js'
import { asSystemPrompt } from '../engine/utils/systemPromptType.js'
import { loadAllPermissionRulesFromDisk } from '../engine/utils/permissions/permissionsLoader.js'
import { applyPermissionRulesToPermissionContext } from '../engine/utils/permissions/permissions.js'
import { applyPermissionUpdate } from '../engine/utils/permissions/PermissionUpdate.js'
import { addPermissionRulesToSettings } from '../engine/utils/permissions/permissionsLoader.js'
import { setOriginalCwd, setCwdState, setProjectRoot, setIsInteractive } from '../engine/bootstrap/state.js'
import { createContentReplacementState, type ContentReplacementState } from '../engine/utils/toolResultStorage.js'
import { initContextCollapse } from '../engine/services/contextCollapse/index.js'
import { runWithCwdOverride } from '../engine/utils/cwd.js'
import { getDefaultAppState, type AppState } from '../engine/state/AppState.js'
import type { MCPServerConnection, ServerResource } from '../engine/services/mcp/types.js'
import type { Tool } from '../engine/Tool.js'
import { getMcpToolsCommandsAndResources } from '../engine/services/mcp/client.js'
import { getAllMcpConfigs } from '../engine/services/mcp/config.js'

const CONFIG_DIR = join(homedir(), '.klaus')
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions')

// sessionId 可能来自 channel(含冒号等非法字符），做成安全的目录名
function sessionDirFor(sessionId: string): string {
  const safe = sessionId.replace(/[^\w-]/g, '_')
  return join(SESSIONS_DIR, safe || '__default__')
}

interface SessionEntry {
  id: string
  title: string
  messages: Message[]
  appState: AppState
  toolPermissionContext: ToolPermissionContext | null
  loopDetector: ToolLoopDetector
  isRunning: boolean
  contentReplacementState: ContentReplacementState
  toolCallCount: number
  createdAt: number
  updatedAt: number
}

class ToolLoopDetector {
  private history: Array<{ toolName: string; argsHash: string; ts: number }> = []
  private readonly maxRepeats = 5
  private readonly windowMs = 30_000

  check(call: { toolName: string; args: unknown }): { block: boolean } | null {
    const now = Date.now()
    const argsHash = JSON.stringify(call.args ?? {}).slice(0, 200)
    this.history = this.history.filter(h => now - h.ts < this.windowMs)
    this.history.push({ toolName: call.toolName, argsHash, ts: now })

    const repeats = this.history.filter(h => h.toolName === call.toolName && h.argsHash === argsHash).length
    if (repeats >= this.maxRepeats) {
      console.warn(`[LoopDetector] Blocked ${call.toolName} — ${repeats} identical calls in ${this.windowMs}ms`)
      return { block: true }
    }
    return null
  }
}

interface McpState {
  clients: MCPServerConnection[]
  tools: Tool[]
  resources: Record<string, ServerResource[]>
}

// Pending permission requests waiting for renderer response
const pendingPermissions = new Map<string, {
  resolve: (resp: PermissionResponse) => void
}>()

export class EngineHost {
  private sessions = new Map<string, SessionEntry>()
  private mcpState: McpState = { clients: [], tools: [], resources: {} }
  private store: SettingsStore
  private messageStore: MessageStore | null = null
  private mainWindow: BrowserWindow | null = null
  private initPromise: Promise<void> | null = null

  constructor(store: SettingsStore) {
    this.store = store
  }

  setMessageStore(ms: MessageStore): void {
    this.messageStore = ms
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this._doInit()
    return this.initPromise
  }

  private async _doInit(): Promise<void> {
    // Fallback cwd — 实际每次 chat() 会通过 runWithCwdOverride 切到 session 自己的目录
    const defaultSessionDir = join(SESSIONS_DIR, '__default__')
    mkdirSync(defaultSessionDir, { recursive: true })
    setOriginalCwd(defaultSessionDir)
    setCwdState(defaultSessionDir)
    setProjectRoot(CONFIG_DIR)
    setIsInteractive(true)

    initContextCollapse()

    await this.initMcp()

    this.seedDefaultPrompts()
  }

  private seedDefaultPrompts(): void {
    const existing = this.store.listPrompts()
    if (existing.length > 0) return

    // Import prompt section getters lazily
    const now = Date.now()
    const defaults = [
      { id: 'intro', name: 'Identity & Role' },
      { id: 'system', name: 'System Rules' },
      { id: 'doing_tasks', name: 'Coding Standards' },
      { id: 'actions', name: 'Action Safety' },
      { id: 'tone_style', name: 'Tone & Style' },
      { id: 'output_efficiency', name: 'Output Efficiency' },
    ]
    for (const d of defaults) {
      this.store.upsertPrompt({
        id: d.id,
        name: d.name,
        content: '', // Empty = use engine default
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // --- MCP ---

  async initMcp(): Promise<void> {
    try {
      const { servers } = await getAllMcpConfigs()
      const state: McpState = { clients: [], tools: [], resources: {} }

      await getMcpToolsCommandsAndResources(
        ({ client, tools, resources }) => {
          state.clients.push(client)
          state.tools.push(...tools)
          if (resources && resources.length > 0) {
            state.resources[client.name] = resources
          }
        },
        servers,
      )

      this.mcpState = state
      console.log(`[MCP] Loaded ${state.clients.length} server(s), ${state.tools.length} tool(s)`)
    } catch (err) {
      console.warn('[MCP] Init failed:', err)
    }
  }

  getMcpStatus(): Array<{ name: string; status: string; toolCount: number }> {
    return this.mcpState.clients.map(c => ({
      name: (c as any).name ?? 'unknown',
      status: (c as any).type === 'connected' ? 'connected' : 'disconnected',
      toolCount: this.mcpState.tools.filter((t: any) => t.mcpInfo?.serverName === (c as any).name).length,
    }))
  }

  async reconnectMcp(): Promise<void> {
    // Close existing
    for (const client of this.mcpState.clients) {
      try {
        if ((client as any).close) await (client as any).close()
      } catch {}
    }
    this.mcpState = { clients: [], tools: [], resources: {} }
    await this.initMcp()
  }

  // --- Skills ---

  listSkills(): Array<{ name: string; description?: string; enabled: boolean; source: string }> {
    const settings = this.store.getSkillSettings()
    const skills: Array<{ name: string; description?: string; enabled: boolean; source: string }> = []
    for (const [name, config] of settings) {
      skills.push({
        name,
        description: undefined,
        enabled: config.enabled !== false,
        source: 'installed',
      })
    }
    return skills
  }

  toggleSkill(name: string, enabled: boolean): void {
    const current = this.store.getSkillSettings().get(name) ?? {}
    this.store.set(`skill:${name}`, JSON.stringify({ ...current, enabled }))
  }

  // --- Sessions ---

  newSession(): SessionInfo {
    const id = randomUUID()
    const now = Date.now()
    const entry: SessionEntry = {
      id,
      title: 'New Chat',
      messages: [],
      appState: getDefaultAppState(),
      toolPermissionContext: null,
      loopDetector: new ToolLoopDetector(),
      isRunning: false,
      contentReplacementState: createContentReplacementState(),
      toolCallCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(id, entry)
    return { id, title: entry.title, createdAt: now, updatedAt: now }
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }))
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    clearSystemPromptSections()
  }

  renameSession(sessionId: string, title: string): void {
    const s = this.sessions.get(sessionId)
    if (s) {
      s.title = title
      s.updatedAt = Date.now()
    }
  }

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    if (!this.messageStore) return []
    const msgs = await this.messageStore.readHistory(sessionId)
    return msgs.map((m, i) => ({
      id: `${sessionId}-${i}`,
      role: m.role,
      text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: m.ts,
    }))
  }

  // --- Chat ---

  async chat(sessionId: string, text: string, _media?: any[]): Promise<void> {
    console.log('[Engine] chat() called', { sessionId, textLen: text?.length })
    // 等待引擎初始化完成（init 仍在后台进行时，chat 自然排队，用户感知不到）
    await this.init()
    console.log('[Engine] chat() init done, entering query')

    let session = this.sessions.get(sessionId)
    if (!session) {
      // Auto-create
      session = {
        id: sessionId,
        title: text.slice(0, 50) || 'New Chat',
        messages: [],
        appState: getDefaultAppState(),
        toolPermissionContext: null,
        loopDetector: new ToolLoopDetector(),
        isRunning: false,
        contentReplacementState: createContentReplacementState(),
        toolCallCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.sessions.set(sessionId, session)
    }

    if (session.isRunning) {
      this.pushEvent({ type: 'api_error', sessionId, error: 'Session is busy' })
      return
    }

    // auth_mode 分叉 + 运行时切换
    // - subscription：清掉 ANTHROPIC_API_KEY/BASE_URL + 解除 SKIP_OAUTH → 引擎走 OAuth
    // - custom：设 ANTHROPIC_API_KEY/BASE_URL + 打开 SKIP_OAUTH → 引擎无视 keychain 里的 OAuth token，走 API key
    // 每次 chat 都重新设环境 + 清 OAuth cache，确保用户在设置里切换后立即生效
    const authMode = (this.store.get('auth_mode') as string) ?? 'subscription'
    const authMod = await import('../engine/utils/auth.js')

    if (authMode === 'subscription') {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_BASE_URL
      delete process.env.ANTHROPIC_AUTH_TOKEN
      delete process.env.CLAUDE_CODE_SKIP_OAUTH
      authMod.clearOAuthTokenCache() // 让 getClaudeAIOAuthTokens 重新从 keychain 读
      const token = authMod.getClaudeAIOAuthTokens()
      if (!token) {
        this.pushEvent({ type: 'auth_required' as any, sessionId, reason: 'not_logged_in', mode: 'subscription' })
        this.pushEvent({ type: 'done', sessionId })
        return
      }
    } else {
      const m = this.store.getDefaultModel() as any
      if (!m || !m.apiKey) {
        this.pushEvent({ type: 'auth_required' as any, sessionId, reason: 'no_model', mode: 'custom' })
        this.pushEvent({ type: 'done', sessionId })
        return
      }
      process.env.ANTHROPIC_API_KEY = m.apiKey
      if (m.baseUrl) process.env.ANTHROPIC_BASE_URL = m.baseUrl
      else delete process.env.ANTHROPIC_BASE_URL
      process.env.CLAUDE_CODE_SKIP_OAUTH = '1' // 屏蔽已登录的 OAuth token（token 本身保留在 keychain，切回 subscription 立即恢复）
      authMod.clearOAuthTokenCache() // 让 memoize 下次读时看到 SKIP_OAUTH
    }

    session.isRunning = true
    session.updatedAt = Date.now()

    // Auto-title from first message
    if (session.messages.length === 0 && text.length > 0) {
      session.title = text.slice(0, 50)
    }

    try {
      // Build tools
      const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool'])
      const tools = [
        ...getAllBaseTools().filter((t: any) => t.isEnabled() && !MCP_RESOURCE_TOOLS.has(t.name)),
        ...this.mcpState.tools,
      ]

      // Build system prompt
      const sectionOverrides: Record<string, string> = {}
      for (const prompt of this.store.listPrompts()) {
        if (prompt.content?.trim()) {
          sectionOverrides[prompt.id] = prompt.content
        }
      }
      console.log('[Engine] building systemPrompt...')
      const systemPromptParts = await getSystemPrompt(
        tools as any,
        this.getModel(),
        undefined,
        this.mcpState.clients,
        sectionOverrides,
      )
      const systemPrompt = asSystemPrompt(systemPromptParts)
      console.log('[Engine] systemPrompt built, parts=', systemPromptParts?.length)

      // Build permission context
      let toolPermissionCtx: ToolPermissionContext = {
        ...getEmptyToolPermissionContext(),
        mode: (this.store.get('permission_mode') as any) ?? 'default',
        isBypassPermissionsModeAvailable: true,
        shouldAvoidPermissionPrompts: false,
      }
      try {
        const rules = loadAllPermissionRulesFromDisk()
        if (rules.length > 0) {
          toolPermissionCtx = applyPermissionRulesToPermissionContext(toolPermissionCtx, rules)
        }
      } catch {}

      // Store permission context and appState on session
      session.toolPermissionContext = toolPermissionCtx

      // 把 EngineHost 外部维护的状态（MCP 连接、权限 ctx）同步进 session.appState，
      // 这样 getAppState 返回的始终是一份完整、最新的 AppState（结构对齐 CC getDefaultAppState）
      session.appState = {
        ...session.appState,
        toolPermissionContext: toolPermissionCtx,
        mcp: {
          ...session.appState.mcp,
          clients: this.mcpState.clients,
          tools: this.mcpState.tools,
          resources: this.mcpState.resources,
        },
      }

      // Permission callback — routes to renderer via IPC
      const onAsk: OnAskCallback = async ({ tool: askTool, input: askInput, message, suggestions }) => {
        // Loop detection
        const loopResult = session!.loopDetector.check({ toolName: askTool.name, args: askInput })
        if (loopResult?.block) {
          return { decision: 'deny' as const }
        }

        const requestId = randomUUID()

        this.pushPermissionRequest({
          requestId,
          toolName: askTool.name,
          toolInput: askInput,
          message,
          suggestions: suggestions?.map(s => ({ ...s } as any)),
        })

        // Wait for renderer response
        const response = await new Promise<PermissionResponse>((resolve) => {
          pendingPermissions.set(requestId, { resolve })
        })

        // Persist accepted suggestions
        if (response.decision === 'allow' && response.acceptedSuggestionIndices && suggestions) {
          for (const idx of response.acceptedSuggestionIndices) {
            const suggestion = suggestions[idx]
            if (suggestion) {
              try {
                toolPermissionCtx = applyPermissionUpdate(toolPermissionCtx, suggestion) as any
                if ((suggestion as any).type === 'addRules' && (suggestion as any).rules && (suggestion as any).behavior) {
                  addPermissionRulesToSettings(
                    { ruleValues: (suggestion as any).rules, ruleBehavior: (suggestion as any).behavior },
                    (suggestion as any).destination ?? 'userSettings',
                  )
                }
              } catch (err) {
                console.warn('[Permission] Failed to persist suggestion:', err)
              }
            }
          }
        }

        return { decision: response.decision, updatedInput: response.updatedInput }
      }

      const canUseTool = createCanUseTool(onAsk)

      // Append user message
      const userMsg: Message = {
        type: 'user',
        message: { role: 'user', content: text },
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      } as any
      session.messages.push(userMsg)

      // Build thinking config
      const modelRecord = this.store.getDefaultModel()
      const thinkingLevel = modelRecord?.thinking ?? 'off'
      const maxCtx = modelRecord?.maxContextTokens ?? 200000
      const thinkingConfig = thinkingLevel === 'off'
        ? { type: 'disabled' as const }
        : { type: 'enabled' as const, budgetTokens: Math.floor(maxCtx * 0.8) }

      // Pick fallback model: 同 provider 下的另一个可用模型（和 Web 端一致）
      const allModels = this.store.listModels()
      const fallbackRecord = allModels.find(
        (m: any) => m.id !== modelRecord?.id && m.provider === modelRecord?.provider && m.model && m.apiKey,
      )

      // Build query params
      const queryParams: QueryParams = {
        messages: session.messages,
        systemPrompt,
        userContext: { currentDate: new Date().toISOString().split('T')[0]! },
        systemContext: {},
        canUseTool,
        toolUseContext: {
          // 消息数组 —— 从 session 来，processUserInput 里会调 setMessages 改它
          messages: session.messages,
          setMessages: (fn: (prev: Message[]) => Message[]) => {
            session.messages = fn(session.messages)
          },
          // 桌面端不切 API key，no-op
          onChangeAPIKey: () => {},
          // MCP server 要求用户交互时触发，桌面端简单 deny
          handleElicitation: async () => ({ action: 'decline' as const }),
          options: {
            commands: [],
            debug: false,
            mainLoopModel: this.getModel(),
            tools: tools as any,
            verbose: false,
            thinkingConfig,
            mcpClients: this.mcpState.clients,
            mcpResources: this.mcpState.resources,
            ideInstallationStatus: null,
            isNonInteractiveSession: false,
            customSystemPrompt: undefined,
            appendSystemPrompt: undefined,
            // CC 结构：activeAgents = 当前可用列表，allAgents = 包含 disabled 的完整列表
            agentDefinitions: { activeAgents: [], allAgents: [] },
            theme: 'dark',
            maxBudgetUsd: undefined,
            hooksConfig: {},
          },
          abortController: new AbortController(),
          readFileState: new Map() as any,
          // CC 原版 toolUseContext 要求这几个 Set 用于 nested memory / skill discovery 追踪
          nestedMemoryAttachmentTriggers: new Set<string>(),
          loadedNestedMemoryPaths: new Set<string>(),
          dynamicSkillDirTriggers: new Set<string>(),
          discoveredSkillNames: new Set<string>(),
          // CC 引擎要求 toolUseContext 必须有这 4 个 setter，桌面端不接入 UI 状态管理，全部 no-op
          setInProgressToolUseIDs: () => {},
          setResponseLength: () => {},
          updateFileHistoryState: () => {},
          updateAttributionState: () => {},
          setSDKStatus: () => {},
          contentReplacementState: session.contentReplacementState,
          // API 凭证 —— subscription 模式下留空，让引擎读 OAuth credentials；custom 模式读 modelRecord
          apiKey: authMode === 'subscription' ? undefined : (modelRecord as any)?.apiKey,
          baseURL: authMode === 'subscription' ? undefined : ((modelRecord as any)?.baseUrl ?? undefined),
          // 同步外部状态进 session.appState（MCP 连接、权限 ctx 都是 EngineHost 级别的）
          // 照搬 CC 模式：getAppState/setAppState 读写同一份完整 AppState
          getAppState: () => session.appState,
          setAppState: (fn: (prev: AppState) => AppState) => {
            const prev = session.appState
            const next = fn(prev)
            // Detect new tasks (agents spawned) — CC 里 tasks 是 Record，按 key 枚举
            for (const id of Object.keys(next.tasks ?? {})) {
              if (!(id in (prev.tasks ?? {}))) {
                const task = (next.tasks as any)[id]
                this.pushEvent({ type: 'teammate_spawned' as any, sessionId, agentId: id, name: task?.name ?? id, color: task?.color })
              }
              const prevTask = (prev.tasks as any)?.[id]
              const nextTask = (next.tasks as any)[id]
              if (prevTask && nextTask) {
                if (prevTask.toolUseCount !== nextTask.toolUseCount) {
                  this.pushEvent({ type: 'agent_progress' as any, sessionId, agentId: id, toolUseCount: nextTask.toolUseCount ?? 0 })
                }
                if (prevTask.status !== nextTask.status && (nextTask.status === 'completed' || nextTask.status === 'failed')) {
                  this.pushEvent({ type: 'agent_done' as any, sessionId, agentId: id, status: nextTask.status })
                }
              }
            }
            session.appState = next
          },
        } as any,
        querySource: 'repl_main_thread' as any,
        maxTurns: 100,
        maxOutputTokensOverride: undefined,
        fallbackModel: fallbackRecord?.model,
        taskBudget: undefined,
      } as any

      // Per-session cwd 作用域 — JSONL 历史、auto-memory 自动落到 ~/.klaus/projects/<session>/
      // skills / MCP / user memory / permissions 来自 CLAUDE_CONFIG_DIR=~/.klaus，全局共享
      const sessionDir = sessionDirFor(sessionId)
      mkdirSync(sessionDir, { recursive: true })

      console.log('[Engine] sessionDir=', sessionDir, 'model=', this.getModel(), 'authMode=', authMode, 'apiKey.len=', (modelRecord as any)?.apiKey?.length, 'baseURL=', (modelRecord as any)?.baseUrl)

      await runWithCwdOverride(sessionDir, async () => {
        console.log('[Engine] calling query()')
        const gen = query(queryParams)
        console.log('[Engine] query() returned generator, awaiting first event...')
        let n = 0
        for await (const event of gen) {
          n++
          console.log(`[Engine] event #${n}:`, (event as any)?.type)
          this.processStreamEvent(sessionId, event as any, session)
        }
        console.log('[Engine] for-await exited, total events=', n)
      })
    } catch (err: any) {
      const msg: string = err?.message ?? String(err)
      // 运行时识别 OAuth token 过期 / 被吊销，转成前端能渲染按钮的 auth_required 事件
      if (/Please run \/login|Not logged in|OAuth token revoked/i.test(msg)) {
        this.pushEvent({ type: 'auth_required' as any, sessionId, reason: 'token_invalid', mode: authMode })
      } else {
        this.pushEvent({ type: 'api_error', sessionId, error: msg })
      }
    } finally {
      session.isRunning = false
      this.pushEvent({ type: 'done', sessionId })

      // Persist messages
      if (this.messageStore) {
        try {
          await this.messageStore.append(sessionId, 'user', text)
          // Find last assistant message text
          const lastMsg = [...session.messages].reverse().find(m => (m as any).type === 'assistant')
          if (lastMsg) {
            const content = (lastMsg as any).message?.content
            const assistantText = Array.isArray(content)
              ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
              : typeof content === 'string' ? content : ''
            if (assistantText) {
              await this.messageStore.append(sessionId, 'assistant', assistantText)
            }
          }
        } catch (err) {
          console.warn('[MessageStore] Failed to persist:', err)
        }
      }
    }
  }

  interrupt(sessionId: string): void {
    // TODO: implement abort via AbortController stored per session
    console.log(`[Engine] Interrupt requested for ${sessionId}`)
  }

  // --- Permission response from renderer ---

  resolvePermission(requestId: string, response: PermissionResponse): void {
    const pending = pendingPermissions.get(requestId)
    if (pending) {
      pending.resolve(response)
      pendingPermissions.delete(requestId)
    }
  }

  // --- Shutdown ---

  async shutdown(): Promise<void> {
    for (const client of this.mcpState.clients) {
      try {
        if ((client as any).close) await (client as any).close()
      } catch {}
    }
    this.sessions.clear()
  }

  // --- Internal ---

  private getModel(): string {
    const m = this.store.getDefaultModel()
    return m?.model ?? 'claude-sonnet-4-20250514'
  }

  private processStreamEvent(sessionId: string, event: any, session: SessionEntry): void {
    if (!event || !event.type) return

    switch (event.type) {
      // 引擎发起 API 请求
      case 'stream_request_start': {
        this.pushEvent({ type: 'stream_mode', sessionId, mode: 'requesting' })
        this.pushEvent({ type: 'requesting' as any, sessionId })
        break
      }

      // 完整的 assistant 消息 —— 把里面的 content 块拆成 UI 能渲染的事件
      // CC query() 默认不发 stream_event（partial messages），所以这里兜底全量
      case 'assistant': {
        session.messages.push(event as Message)
        const content = (event as any).message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'responding' })
              this.pushEvent({ type: 'text_delta', sessionId, text: block.text } as any)
            } else if ((block.type === 'thinking' || block.type === 'redacted_thinking') && (block.thinking || block.data)) {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'thinking' })
              this.pushEvent({ type: 'thinking_delta', sessionId, thinking: block.thinking ?? block.data ?? '' } as any)
            } else if (block.type === 'tool_use') {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'tool-use' })
              this.pushEvent({
                type: 'tool_start', sessionId,
                toolName: block.name ?? '', toolCallId: block.id ?? '', args: block.input ?? {},
              })
              // 一次性把完整 input 作为 JSON 推给前端（前端靠累积 tool_input_delta 显示工具参数）
              if (block.input) {
                this.pushEvent({
                  type: 'tool_input_delta' as any, sessionId,
                  toolCallId: block.id ?? '',
                  delta: JSON.stringify(block.input),
                })
              }
            }
          }
        }
        this.pushEvent({ type: 'message_complete' as any, sessionId, message: event })
        break
      }

      // user 消息（工具结果）
      case 'user': {
        session.messages.push(event as Message)
        const userContent = (event as any).message?.content
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              session.toolCallCount++
              this.pushEvent({
                type: 'tool_end', sessionId,
                toolName: (block as any).toolName ?? '',
                toolCallId: block.tool_use_id ?? '',
                isError: block.is_error ?? false,
              })
            }
          }
        }
        break
      }

      // API 原始流式事件（includePartialMessages=true 时才会有；桌面端目前 false，基本不会走到）
      case 'stream_event': {
        const se = event.event ?? event
        this.processApiStreamEvent(sessionId, se)
        break
      }

      // 系统消息：压缩边界 / API 错误 / 重试
      case 'system': {
        if (event.subtype === 'compact_boundary') {
          this.pushEvent({ type: 'compaction_end' as any, sessionId })
          this.pushEvent({ type: 'compact_boundary' as any, sessionId })
        } else if (event.subtype === 'api_error') {
          this.pushEvent({
            type: 'api_error', sessionId,
            error: event.error?.message ?? 'API error',
          })
          this.pushEvent({
            type: 'api_retry' as any, sessionId,
            attempt: event.retryAttempt ?? 0,
            maxRetries: event.maxRetries ?? 0,
            error: event.error?.message ?? 'API error',
            delayMs: event.delayMs ?? 0,
          })
        }
        break
      }

      // 消息被压缩掉
      case 'tombstone': {
        this.pushEvent({ type: 'tombstone' as any, sessionId, messageUuid: event.messageUuid ?? event.uuid ?? '' })
        break
      }

      // 工具执行进度
      case 'progress':
      case 'tool_progress': {
        this.pushEvent({
          type: 'progress', sessionId,
          toolName: event.toolName ?? '',
          toolCallId: event.toolCallId ?? event.tool_use_id ?? event.toolUseId ?? '',
          content: event.content ?? '',
        })
        break
      }

      // 上下文折叠统计
      case 'context_collapse_stats': {
        this.pushEvent({
          type: 'context_collapse_stats', sessionId,
          collapsedSpans: event.collapsedSpans ?? 0,
          stagedSpans: event.stagedSpans ?? 0,
        })
        break
      }

      // 文件产物
      case 'file': {
        this.pushEvent({ type: 'file' as any, sessionId, name: event.name, url: event.url })
        break
      }
    }
  }

  private processApiStreamEvent(sessionId: string, event: any): void {
    if (!event?.type) return

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (block?.type === 'thinking') {
          this.pushEvent({ type: 'stream_mode', sessionId, mode: 'thinking' })
        } else if (block?.type === 'text') {
          this.pushEvent({ type: 'stream_mode', sessionId, mode: 'responding' })
        } else if (block?.type === 'tool_use') {
          this.pushEvent({ type: 'stream_mode', sessionId, mode: 'tool-input' })
          this.pushEvent({
            type: 'tool_start', sessionId,
            toolName: block.name ?? '', toolCallId: block.id ?? '', args: {},
          })
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (delta?.type === 'text_delta' && delta.text) {
          this.pushEvent({ type: 'text_delta', sessionId, text: delta.text })
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          this.pushEvent({ type: 'thinking_delta', sessionId, thinking: delta.thinking })
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          this.pushEvent({
            type: 'tool_input_delta', sessionId,
            toolCallId: '', delta: delta.partial_json,
          })
        }
        break
      }
      case 'message_start': {
        this.pushEvent({ type: 'stream_mode', sessionId, mode: 'requesting' })
        break
      }
    }
  }

  private pushEvent(event: EngineEvent): void {
    this.mainWindow?.webContents.send('chat:event', event)
  }

  private pushPermissionRequest(req: PermissionRequest): void {
    this.mainWindow?.webContents.send('permission:request', req)
  }
}
