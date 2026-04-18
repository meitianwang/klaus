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
import {
  getSystemPrompt,
  getSimpleIntroSection,
  getSimpleSystemSection,
  getSimpleDoingTasksSection,
  getActionsSection,
  getSimpleToneAndStyleSection,
  getOutputEfficiencySection,
  getScratchpadInstructions,
  SUMMARIZE_TOOL_RESULTS_SECTION,
} from '../engine/constants/prompts.js'
import { DEFAULT_PREFIX as CLI_PREFIX_DEFAULT } from '../engine/constants/system.js'
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

// 官方静态段 —— seed 到数据库,UI 可编辑,chat 时通过 sectionOverrides 覆盖引擎默认
// id 必须和 Klaus 版 prompts.ts 里 ov(...) 的 key 一致，否则 override 不生效
export const OFFICIAL_STATIC_SECTIONS: Array<{ id: string; name: string; defaultText: () => string | null }> = [
  // CLI 顶部身份 prefix — 这段 CC 原版写死在 services/api/claude.ts:1338 通过 getCLISyspromptPrefix 硬 prepend
  // Klaus 改造：getCLISyspromptPrefix 优先读 process.env.KLAUS_CLI_PREFIX，运行时 engine-host.chat 注入数据库值
  { id: 'cli_prefix', name: 'CLI Identity', defaultText: () => CLI_PREFIX_DEFAULT },
  { id: 'intro', name: 'Identity & Role', defaultText: () => getSimpleIntroSection(null as any) },
  { id: 'system', name: 'System Rules', defaultText: () => getSimpleSystemSection() },
  { id: 'doing_tasks', name: 'Coding Standards', defaultText: () => getSimpleDoingTasksSection() },
  { id: 'actions', name: 'Action Safety', defaultText: () => getActionsSection() },
  { id: 'tone_style', name: 'Tone & Style', defaultText: () => getSimpleToneAndStyleSection() },
  { id: 'output_efficiency', name: 'Output Efficiency', defaultText: () => getOutputEfficiencySection() },
  { id: 'scratchpad', name: 'Scratchpad Instructions', defaultText: () => getScratchpadInstructions() },
  { id: 'summarize_tool_results', name: 'Summarize Tool Results', defaultText: () => SUMMARIZE_TOOL_RESULTS_SECTION },
]

// 官方动态段 —— 依赖运行时状态（cwd / date / model / tools / memory），UI 只读展示
export const OFFICIAL_DYNAMIC_SECTIONS: Array<{ id: string; name: string; desc: string }> = [
  { id: 'session_guidance', name: 'Session Guidance', desc: '依赖当前可用工具与技能' },
  { id: 'memory', name: 'Memory (KLAUS.md)', desc: '读项目/用户 KLAUS.md 内容' },
  { id: 'env_info_simple', name: 'Environment Info', desc: '当前工作目录、日期、模型' },
  { id: 'ant_model_override', name: 'Ant Model Override', desc: '依赖当前模型' },
  { id: 'language', name: 'Language Preference', desc: '依赖用户语言设置' },
  { id: 'output_style', name: 'Output Style Config', desc: '依赖 outputStyle 配置文件' },
  { id: 'frc', name: 'Function Result Clearing', desc: '依赖当前模型' },
]

const OFFICIAL_STATIC_IDS = new Set(OFFICIAL_STATIC_SECTIONS.map(s => s.id))
const OFFICIAL_DYNAMIC_IDS = new Set(OFFICIAL_DYNAMIC_SECTIONS.map(s => s.id))
const ALL_OFFICIAL_IDS = new Set([...OFFICIAL_STATIC_IDS, ...OFFICIAL_DYNAMIC_IDS])

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
  abortController: AbortController | null // 当前正在运行的 query 的 AbortController；interrupt 时取出来调 abort()
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
  // Per-session event/permission forwarders — mirrors Web 端 gateway：
  // caller of chat() registers an onEvent callback and only that callback receives
  // the engine's stream events. External channels (wechat/…) don't register a forwarder,
  // so their stream events are NOT pushed to the UI at all. No client-side filtering needed.
  private sessionEmitters = new Map<string, (event: EngineEvent) => void>()
  private sessionPermissionEmitters = new Map<string, (req: PermissionRequest) => void>()

  constructor(store: SettingsStore) {
    this.store = store
  }

  setMessageStore(ms: MessageStore): void {
    this.messageStore = ms
    // 启动时扫磁盘重建 in-memory session 元数据（messages 先不加载，chat/getHistory 按需读）
    // 对齐 CC 启动时从 ~/.claude/projects/<cwd>/*.jsonl 发现 session 的做法
    ms.listSessions().then(summaries => {
      for (const s of summaries) {
        if (this.sessions.has(s.sessionKey)) continue
        this.sessions.set(s.sessionKey, {
          id: s.sessionKey,
          title: s.title,
          messages: [], // 懒加载：chat() 或 getHistory() 时才从磁盘读回
          appState: getDefaultAppState(),
          toolPermissionContext: null,
          loopDetector: new ToolLoopDetector(),
          isRunning: false,
          contentReplacementState: createContentReplacementState(),
          toolCallCount: 0,
          abortController: null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })
      }
      console.log(`[Engine] Restored ${summaries.length} session(s) from disk`)
    }).catch(err => console.warn('[Engine] Failed to restore sessions:', err))
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
    // Seed 所有官方静态段 —— 把引擎 getter 的默认文案"搬"进数据库作为初始值
    // 已有 id 不覆盖（用户可能已编辑过）；content 为空的重新填默认文案
    const existing = new Map(this.store.listPrompts().map(p => [p.id, p]))
    const now = Date.now()
    for (const sec of OFFICIAL_STATIC_SECTIONS) {
      const got = existing.get(sec.id)
      if (got && got.content?.trim()) continue
      try {
        const defaultText = sec.defaultText() ?? ''
        this.store.upsertPrompt({
          id: sec.id,
          name: sec.name,
          content: defaultText,
          isDefault: false,
          createdAt: got?.createdAt ?? now,
          updatedAt: now,
        } as any)
      } catch (err) {
        console.warn(`[Engine] Failed to seed section "${sec.id}":`, err)
      }
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
      // Sentinel: renderer maps the fixed string 'New Chat' to tt('new_chat').
      title: 'New Chat',
      messages: [],
      appState: getDefaultAppState(),
      toolPermissionContext: null,
      loopDetector: new ToolLoopDetector(),
      isRunning: false,
      contentReplacementState: createContentReplacementState(),
      toolCallCount: 0,
      abortController: null,
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
    this.messageStore?.deleteSession(sessionId) // 同步删磁盘 JSONL，下次启动不会再出现
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

  async chat(
    sessionId: string,
    text: string,
    _media?: any[],
    options?: {
      onEvent?: (event: EngineEvent) => void
      onPermissionRequest?: (req: PermissionRequest) => void
    },
  ): Promise<string> {
    // Register per-session forwarders. Only the caller that provided onEvent
    // receives stream events — aligns with Web 端 gateway.createAgentEventForwarder pattern.
    if (options?.onEvent) this.sessionEmitters.set(sessionId, options.onEvent)
    if (options?.onPermissionRequest) this.sessionPermissionEmitters.set(sessionId, options.onPermissionRequest)
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
        abortController: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.sessions.set(sessionId, session)
    }

    // 懒加载历史：启动后第一次对这个 session 发消息时，把磁盘里的 JSONL 读回内存，
    // 让模型能看到历史上下文续上下文。对齐 CC --resume 的加载时机。
    if (session.messages.length === 0 && this.messageStore) {
      try {
        const history = await this.messageStore.readHistory(sessionId)
        for (const m of history) {
          const contentText = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((b: any) => b.text ?? '').join('')
              : ''
          session.messages.push({
            type: m.role,
            message: {
              role: m.role,
              // 引擎 normalizeMessagesForAPI 对 user case 接受 string，对 assistant case 调 .map 必须 array
              content: m.role === 'assistant'
                ? [{ type: 'text', text: contentText }]
                : contentText,
            },
            uuid: randomUUID(),
            timestamp: new Date(m.ts || Date.now()).toISOString(),
          } as any)
        }
        if (history.length > 0) console.log(`[Engine] Loaded ${history.length} historical message(s) for session ${sessionId}`)
      } catch (err) {
        console.warn('[Engine] Failed to load session history:', err)
      }
    }

    if (session.isRunning) {
      this.pushEvent({ type: 'api_error', sessionId, error: 'Session is busy' })
      return ''
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
        return ''
      }
    } else {
      const m = this.store.getDefaultModel() as any
      if (!m || !m.apiKey) {
        this.pushEvent({ type: 'auth_required' as any, sessionId, reason: 'no_model', mode: 'custom' })
        this.pushEvent({ type: 'done', sessionId })
        return ''
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

      // Build system prompt:
      //  - cli_prefix：特例，API 客户端层硬 prepend，通过 env 注入
      //  - 官方 id 的 prompt 走 sectionOverrides（覆盖引擎对应段的默认文案）
      //  - 非官方 id（用户添加的自定义段）走 customAppendSections（追加到 system prompt 末尾）
      const sectionOverrides: Record<string, string> = {}
      const customAppendSections: Array<{ name: string; content: string }> = []
      let cliPrefixOverride: string | null = null
      for (const prompt of this.store.listPrompts()) {
        if (!prompt.content?.trim()) continue
        if (prompt.id === 'cli_prefix') {
          cliPrefixOverride = prompt.content
        } else if (ALL_OFFICIAL_IDS.has(prompt.id)) {
          sectionOverrides[prompt.id] = prompt.content
        } else {
          customAppendSections.push({ name: prompt.name, content: prompt.content })
        }
      }
      // 注入 / 清除 CLI prefix env：engine/constants/system.ts:getCLISyspromptPrefix 会在开头读它
      if (cliPrefixOverride) process.env.KLAUS_CLI_PREFIX = cliPrefixOverride
      else delete process.env.KLAUS_CLI_PREFIX
      console.log('[Engine] building systemPrompt...')
      const systemPromptParts = await getSystemPrompt(
        tools as any,
        this.getModel(),
        undefined,
        this.mcpState.clients,
        sectionOverrides,
        undefined, // disabledSkills
        customAppendSections,
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

        this.pushPermissionRequest(sessionId, {
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
      // Only push the user msg if the lazy-loaded history doesn't already contain
      // it as the tail. Channel plugins (wechat/feishu/…) transcribe the user msg
      // to disk BEFORE calling handler→chat(), so readHistory above already put it
      // into session.messages. Skipping here avoids the model seeing two identical
      // user turns (which caused duplicated replies).
      const tail = session.messages[session.messages.length - 1] as any
      const tailIsSameUser = tail
        && tail.type === 'user'
        && (typeof tail.message?.content === 'string' ? tail.message.content : '') === text
      if (!tailIsSameUser) {
        const userMsg: Message = {
          type: 'user',
          message: { role: 'user', content: text },
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
        } as any
        session.messages.push(userMsg)
      }

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
          // 存到 session 上，让 interrupt() 能取到；query 退出时在 finally 里清掉
          abortController: (session.abortController = new AbortController()),
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
      const isAbort = err?.name === 'AbortError'
        || session.abortController?.signal?.aborted
        || /aborted|user-cancel/i.test(msg)
      if (isAbort) {
        // 用户主动中断，不当 API 错误；推一个 interrupted 事件供前端展示（当前前端忽略）
        this.pushEvent({ type: 'interrupted' as any, sessionId })
      } else if (/Please run \/login|Not logged in|OAuth token revoked/i.test(msg)) {
        // 运行时识别 OAuth token 过期 / 被吊销，转成前端能渲染按钮的 auth_required 事件
        this.pushEvent({ type: 'auth_required' as any, sessionId, reason: 'token_invalid', mode: authMode })
      } else {
        this.pushEvent({ type: 'api_error', sessionId, error: msg })
      }
    } finally {
      session.isRunning = false
      session.abortController = null // 查询结束（无论成败/中断）都清，下次 chat 新建
      this.pushEvent({ type: 'done', sessionId })
      // Unregister per-session forwarders so late events from abandoned queries don't leak.
      this.sessionEmitters.delete(sessionId)
      this.sessionPermissionEmitters.delete(sessionId)
    }

    // Extract final assistant text from session.messages — returned to the caller.
    // Persistence is the CALLER's responsibility (aligns with Web 端 agent-manager,
    // which never writes MessageStore itself — see src/agent-manager.ts):
    //   - Channels write via ctx.transcript() in src/channels/manager.ts:340
    //   - Desktop IPC chat:send writes after chat() returns (ipc-handlers.ts)
    // Double-writing here would duplicate every message on disk.
    let assistantText = ''
    const lastMsg = [...session.messages].reverse().find(m => (m as any).type === 'assistant')
    if (lastMsg) {
      const content = (lastMsg as any).message?.content
      assistantText = Array.isArray(content)
        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : typeof content === 'string' ? content : ''
    }

    return assistantText
  }

  interrupt(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.abortController) return
    console.log(`[Engine] Interrupt requested for ${sessionId}`)
    // 对齐 CC REPL.tsx:2147：abortController.abort('user-cancel')
    session.abortController.abort('user-cancel')
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
    // Server-side dispatch (mirrors Web 端 gateway): only the session's registered
    // forwarder receives the event. External channels (no forwarder registered) never
    // see engine stream events — removes the need for client-side sessionId filtering.
    const sessionId = (event as any).sessionId
    const emit = sessionId ? this.sessionEmitters.get(sessionId) : undefined
    if (emit) emit(event)
  }

  private pushPermissionRequest(sessionId: string, req: PermissionRequest): void {
    const emit = this.sessionPermissionEmitters.get(sessionId)
    if (emit) emit(req)
    // If no emitter registered (e.g. external channel), the onAsk await would hang —
    // caller must ensure permission_mode=auto/bypass when no UI is available.
  }

  // Public hook for main-process owners (main window, future tray badge, …) to
  // receive a targeted 'session touched' notification whenever any channel
  // produces a reply — used to refresh the sidebar for channel-created sessions.
  // Mirrors Web 端 buildNotify in src/index.ts:202.
  notifySessionTouched(sessionId: string, role: 'user' | 'assistant', text: string): void {
    this.mainWindow?.webContents.send('session:touched', { sessionId, role, text })
  }
}
