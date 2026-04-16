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
import type { MCPServerConnection, ServerResource } from '../engine/services/mcp/types.js'
import type { Tool } from '../engine/Tool.js'
import { getMcpToolsCommandsAndResources } from '../engine/services/mcp/client.js'
import { getAllMcpConfigs } from '../engine/services/mcp/config.js'

const CONFIG_DIR = join(homedir(), '.klaus')

interface SessionEntry {
  id: string
  title: string
  messages: Message[]
  appState: any | null
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

  constructor(store: SettingsStore) {
    this.store = store
  }

  setMessageStore(ms: MessageStore): void {
    this.messageStore = ms
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async init(): Promise<void> {
    // Set engine CWD state
    const cwd = homedir()
    setOriginalCwd(cwd)
    setCwdState(cwd)
    setProjectRoot(CONFIG_DIR)
    setIsInteractive(true)

    // Initialize context collapse
    initContextCollapse()

    // Initialize MCP
    await this.initMcp()

    // Seed default prompt sections if empty
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

  // --- Sessions ---

  newSession(): SessionInfo {
    const id = randomUUID()
    const now = Date.now()
    const entry: SessionEntry = {
      id,
      title: 'New Chat',
      messages: [],
      appState: null,
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
    let session = this.sessions.get(sessionId)
    if (!session) {
      // Auto-create
      session = {
        id: sessionId,
        title: text.slice(0, 50) || 'New Chat',
        messages: [],
        appState: null,
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
      const systemPromptParts = await getSystemPrompt(
        tools as any,
        this.getModel(),
        undefined,
        this.mcpState.clients,
        sectionOverrides,
      )
      const systemPrompt = asSystemPrompt(systemPromptParts)

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

      // Build query params
      const queryParams: QueryParams = {
        messages: session.messages,
        systemPrompt,
        userContext: { currentDate: new Date().toISOString().split('T')[0]! },
        systemContext: {},
        canUseTool,
        toolUseContext: {
          options: {
            commands: [],
            debug: false,
            mainLoopModel: this.getModel(),
            tools: tools as any,
            verbose: false,
            thinkingConfig,
            mcpClients: this.mcpState.clients,
            mcpResources: this.mcpState.resources,
            isNonInteractiveSession: false,
            agentDefinitions: { bundledAgents: [], userAgents: [] } as any,
          },
          abortController: new AbortController(),
          readFileState: new Map() as any,
          getAppState: () => ({
            toolPermissionContext: toolPermissionCtx,
            tasks: new Map(),
          } as any),
          setAppState: () => {},
          messages: session.messages,
        } as any,
        querySource: 'repl_main_thread' as any,
        maxTurns: 100,
      } as any

      // Run query
      const gen = query(queryParams)
      for await (const event of gen) {
        this.processStreamEvent(sessionId, event as any, session)
      }
    } catch (err: any) {
      this.pushEvent({ type: 'api_error', sessionId, error: err?.message ?? String(err) })
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
      case 'assistant': {
        // Full assistant message
        session.messages.push(event as Message)
        break
      }
      case 'user': {
        // Tool result message
        session.messages.push(event as Message)
        session.toolCallCount++
        break
      }
      case 'stream_event': {
        const se = event.event ?? event
        this.processApiStreamEvent(sessionId, se)
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
