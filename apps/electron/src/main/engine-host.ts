import { randomUUID } from 'crypto'
import { join, basename as pathBasename, dirname } from 'path'
import { homedir } from 'os'
import { mkdirSync, unlinkSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import type { BrowserWindow } from 'electron'
import type { SettingsStore } from './settings-store.js'
import { SessionKeyRegistry } from './session-registry.js'
import type { EngineEvent, PermissionRequest, PermissionResponse, SessionInfo, ChatMessage, ArtifactOp, ContextStats, CompactSessionResult } from '../shared/types.js'

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
import { setOriginalCwd, setCwdState, setProjectRoot, setIsInteractive, switchSession, setQuestionPreviewFormat, setMainThreadAgentType, markPostCompaction } from '../engine/bootstrap/state.js'
import { getAgentDefinitionsWithOverrides, clearAgentDefinitionsCache } from '../engine/tools/AgentTool/loadAgentsDir.js'
import { createContentReplacementState, type ContentReplacementState } from '../engine/utils/toolResultStorage.js'
import { initContextCollapse } from '../engine/services/contextCollapse/index.js'
import { runWithCwdOverride } from '../engine/utils/cwd.js'
import { getDefaultAppState, type AppState } from '../engine/state/AppState.js'
import type { MCPServerConnection, ServerResource } from '../engine/services/mcp/types.js'
import type { Tool } from '../engine/Tool.js'
import { getMcpToolsCommandsAndResources } from '../engine/services/mcp/client.js'
import { getAllMcpConfigs } from '../engine/services/mcp/config.js'
import { revokeServerTokens } from '../engine/services/mcp/auth.js'
import {
  recordTranscript,
  loadTranscriptFile,
  getSessionFilesLite,
  getTranscriptPathForSession,
  getProjectDir,
  resetSessionFilePointer,
  enrichLogs,
  saveCustomTitle,
  buildConversationChain,
  clearSessionMetadata,
  removeTranscriptMessage,
  adoptResumedSessionFile,
} from '../engine/utils/sessionStorage.js'
import {
  fileHistoryRewind,
  fileHistoryRestoreStateFromLog,
  type FileHistoryState,
  type FileHistorySnapshot,
} from '../engine/utils/fileHistory.js'
import {
  listTasks as engineListTasks,
  onTasksUpdated,
  getTaskListId as engineGetTaskListId,
  getTasksDir as engineGetTasksDir,
  type Task as EngineTask,
} from '../engine/utils/tasks.js'
import type { TaskItem } from '../shared/types.js'
// Context/compact APIs — consumed by getContextStats / compactSession.
// All of these are public exports of the (unmodified) Klaus engine fork; we
// just reuse them from main as out-of-turn callers, replicating the glue that
// CC's `commands/compact/compact.ts` runs in-process.
import { analyzeContextUsage } from '../engine/utils/analyzeContext.js'
import {
  compactConversation,
  buildPostCompactMessages,
} from '../engine/services/compact/compact.js'
import { runPostCompactCleanup } from '../engine/services/compact/postCompactCleanup.js'
import { suppressCompactWarning } from '../engine/services/compact/compactWarningState.js'
import { setLastSummarizedMessageId } from '../engine/services/SessionMemory/sessionMemoryUtils.js'
import {
  getMessagesAfterCompactBoundary,
  createSyntheticUserCaveatMessage,
  createUserMessage as engineCreateUserMessage,
  formatCommandInputTags,
} from '../engine/utils/messages.js'
import {
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../engine/constants/xml.js'
import { tokenCountWithEstimation } from '../engine/utils/tokens.js'
import {
  calculateTokenWarningState,
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../engine/services/compact/autoCompact.js'

const CONFIG_DIR = join(homedir(), '.klaus')
const SESSIONS_DIR = join(CONFIG_DIR, 'sessions')

// One shared "pseudo cwd" used for every Klaus session so that
// `getProjectDir(CANONICAL_CWD)` produces a stable, single project directory
// (`~/.klaus/projects/<sanitized>/`). All session JSONLs land there, letting
// `getSessionFilesLite` scan a single folder for the whole sidebar — mirrors
// the way CC CLI organizes sessions per-project without actually caring what
// "project" means to a desktop chat app.
const CANONICAL_CWD = join(CONFIG_DIR, 'sessions', '__klaus__')
mkdirSync(CANONICAL_CWD, { recursive: true })

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

/**
 * Walk a session's messages backwards to find the tool_use that matches a
 * tool_result, and return file_path + op when the tool is one that writes
 * files (Write/Edit/NotebookEdit). Returns null otherwise.
 */
function findArtifactFromToolUse(
  messages: ReadonlyArray<unknown>,
  toolUseId: string | undefined,
): { filePath: string; op: ArtifactOp } | null {
  if (!toolUseId) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { type?: string; message?: { content?: unknown } }
    if (m?.type !== 'assistant') continue
    const blocks = m.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      const block = b as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
      if (block.type !== 'tool_use' || block.id !== toolUseId) continue
      const name = block.name
      const input = block.input ?? {}
      if (name === 'Write' || name === 'Edit') {
        const fp = input['file_path']
        if (typeof fp === 'string' && fp.length > 0) {
          return { filePath: fp, op: name === 'Write' ? 'write' : 'edit' }
        }
      } else if (name === 'NotebookEdit') {
        const fp = input['notebook_path']
        if (typeof fp === 'string' && fp.length > 0) {
          return { filePath: fp, op: 'notebook_edit' }
        }
      }
      return null
    }
  }
  return null
}

interface SessionEntry {
  /** Channel-key — stable business id (e.g. "wechat:senderId"). */
  id: string
  /** Engine uuid — CC's sessionStorage key; transcripts live at <projectDir>/<uuid>.jsonl. */
  uuid: string
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
  /**
   * Set by deleteSession when the user removes the session while a chat() is
   * still running. recordTranscript / processStreamEvent check this flag and
   * skip, so a late stream event can't re-create the JSONL we just unlinked
   * or mutate an entry that's already been evicted from the map.
   */
  deleted?: boolean
  /**
   * Tail of the persisted parent-chain. `recordTranscript` stamps each new
   * message's `parentUuid` from this cursor; we update it after every write.
   * Kept on the entry (not on a chat()-local variable) so consecutive chat
   * turns in the same session keep threading into a single linear transcript
   * instead of starting fresh roots (which would break `buildConversationChain`
   * readers). Undefined only at first write after a cold start; lazy-load
   * seeds it from the tail of on-disk history.
   */
  lastRecordedUuid?: string
  /**
   * 每个 message id 上已经通过 partial stream_event (content_block_start /
   * content_block_delta) 推送过的 block 类型集合。`case 'assistant':` 在收到
   * 完整 assistant 消息时据此跳过对应 block 的兜底推送，避免双倍渲染。
   *
   * 上游发过 partial（官方 API、Anthropic SDK 直连）→ map 有记录，按类型跳过；
   * 上游只发完整 assistant 不发 partial（kimi-code / 部分 Bedrock 代理）→ map 为空，
   * 全部兜底补发。新增 block 类型只需在 partial 流处理里把 type 记进来，
   * 兜底逻辑自动跟上，不用再加专门的 Set。
   */
  streamedBlockTypes: Map<string, Set<string>>
  /** message_start 记录的当前流式 message id，供后续 content_block_delta 归属到对应 message。 */
  currentStreamingMessageId?: string
  /**
   * `stream_request_start` 时打的本地时间戳。case 'assistant' 收到首条带非 thinking
   * block（text / tool_use）的消息时计算 elapsed 写到 sidecar，作为"思考时长"的
   * 真实测量值（CC JSONL 不带 duration，恢复时只能靠这份外挂数据还原 live 显示）。
   * sawThinkingInResponse 标记本次 model 调用里是否真出现过 thinking，没出现就别写。
   */
  streamThinkingStartTs?: number
  sawThinkingInResponse?: boolean
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

// 工具结果可能是 string 或 Anthropic content-block 数组（含 text/image/...）。
// 渲染端只展示文本，所以拍平 array → text 拼接，image 用占位符标注；硬上限 8KB
// 避免大输出（万行 grep）冲爆 IPC 通道。
//
// CC 引擎会在某些工具结果里注入 <system-reminder> 给模型看（如 FileReadTool
// 的反恶意代码提示）。这是给模型的 in-context 安全提示，不应展示给用户 ——
// 仅在 UI 展示路径剥离掉，transcript 里原始 content 保持不变。
const TOOL_RESULT_MAX = 8 * 1024
const SYSTEM_REMINDER_RE = /\n*<system-reminder>[\s\S]*?<\/system-reminder>\n*/g
function stringifyToolResultContent(content: unknown): string {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((b) => {
        if (!b || typeof b !== 'object') return ''
        const block = b as { type?: string; text?: string }
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (block.type === 'image') return '[image]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  } else {
    text = ''
  }
  text = text.replace(SYSTEM_REMINDER_RE, '').trimEnd()
  if (text.length > TOOL_RESULT_MAX) {
    text = text.slice(0, TOOL_RESULT_MAX) + `\n…[truncated, ${text.length - TOOL_RESULT_MAX} more chars]`
  }
  return text
}

// Parse the tool_result string produced by AskUserQuestionTool's
// mapToolResultToToolResultBlockParam back into a {question: answer} map, so
// the renderer can rebuild the resolved question card on history load. If the
// user denied/interrupted instead, returns { status: 'denied' }.
function parseAskUserQuestionResult(text: string):
  | { status: 'answered'; answers: Record<string, string> }
  | { status: 'denied' } {
  // Engine writes "User denied permission" when canUseTool returns deny.
  if (/^user\s+denied\s+permission/i.test(text.trim())) {
    return { status: 'denied' }
  }
  // Answered format:
  //   User has answered your questions: "Q1"="A1", "Q2"="A2". You can now ...
  // Answers can contain commas (multi-select joined by ", "), so we match
  // "Q"="A" pairs directly rather than splitting on commas.
  const answers: Record<string, string> = {}
  const re = /"([^"]+)"="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    answers[match[1]] = match[2]
  }
  if (Object.keys(answers).length === 0) return { status: 'denied' }
  return { status: 'answered', answers }
}

export class EngineHost {
  // in-memory session state — mirrored by CC's own JSONL on disk.
  // `id` here is the channel-key (e.g. "wechat:o9cq..."), not the engine uuid.
  // engine uuid lives in `uuid` below; registry maps channelKey → uuid.
  private sessions = new Map<string, SessionEntry>()
  private registry = new SessionKeyRegistry()
  private mcpState: McpState = { clients: [], tools: [], resources: {} }
  private store: SettingsStore
  private mainWindow: BrowserWindow | null = null
  private initPromise: Promise<void> | null = null
  // Klaus built-in connectors (macOS system integrations). Wired in from
  // main/index.ts; optional because tests may skip it.
  private connectors: import('./connector-manager.js').ConnectorManager | null = null
  // Per-session event/permission forwarders — mirrors Web 端 gateway：
  // caller of chat() registers an onEvent callback and only that callback receives
  // the engine's stream events. External channels (wechat/…) don't register a forwarder,
  // so their stream events are NOT pushed to the UI at all.
  private sessionEmitters = new Map<string, (event: EngineEvent) => void>()
  private sessionPermissionEmitters = new Map<string, (req: PermissionRequest) => void>()
  // Global chat serialization: CC's session state (STATE.sessionId and
  // STATE.sessionProjectDir in bootstrap/state.ts) is module-global, NOT
  // AsyncLocalStorage-scoped. Concurrent chats from different channelKeys would
  // race `switchSession` and end up writing transcripts to the wrong uuid.
  // Single-lane queue preserves FIFO ordering across all callers.
  private chatQueue: Promise<unknown> = Promise.resolve()

  // Subscriber for engine task list changes (CC TaskCreate/TaskUpdate writes
  // call notifyTasksUpdated → this fires → broadcast to the matching session
  // emitter). Mirrors CC's TasksV2Store + TaskListV2 panel data feed.
  private taskListUnsubscribe: (() => void) | null = null

  constructor(store: SettingsStore) {
    this.store = store
    // Rehydrate only channel sessions (wechat/qq/feishu/…) from the registry.
    // UI sessions don't live in the registry anymore — they're plain uuids
    // discovered by listSessions scanning the project dir. Skipping app:*
    // remnants here avoids resurrecting empty "New Chat" ghosts left behind
    // by the pre-alignment rotate mechanism.
    for (const { channelKey } of this.registry.entries()) {
      if (channelKey.startsWith('app:')) continue
      this.ensureSession(channelKey)
    }
    // Listen once for global task-list mutations. Listener captures the
    // current task list id (= sessionId for standalone sessions; team name
    // for swarm sessions) at notify time, reads disk, broadcasts to whichever
    // session emitter matches. Wrapped in async IIFE to avoid making the
    // listener a returned Promise.
    this.taskListUnsubscribe = onTasksUpdated(() => {
      void this.broadcastTaskList()
    })
  }

  /** Snapshot the current task list and push it to the matching session.
   *  CC's getTaskListId() resolves to the engine uuid for standalone chats,
   *  or a team name for swarm chats. The renderer keys its session cache by
   *  the channelKey it sent in chat:send (which equals the uuid for UI
   *  sessions, but differs for channel sessions like wechat:*). Map back
   *  via the session entry's uuid so channel sessions also see updates. */
  private async broadcastTaskList(): Promise<void> {
    let taskListId: string
    try {
      taskListId = engineGetTaskListId()
    } catch {
      return
    }
    if (!taskListId) return
    const tasks = await this.readTasksForList(taskListId).catch((err) => {
      console.warn('[Engine] task list read failed:', err)
      return [] as TaskItem[]
    })
    // Direct hit: standalone UI session whose channelKey is the uuid.
    const direct = this.sessionEmitters.get(taskListId)
    if (direct) {
      direct({ type: 'task_list', sessionId: taskListId, taskListId, tasks })
      return
    }
    // Channel sessions / team mode: find the session entry whose uuid
    // matches taskListId and emit under that entry's channelKey. Loops over
    // the in-memory session map (capped by max_sessions, so O(n) is fine).
    for (const [channelKey, entry] of this.sessions) {
      if (entry.uuid !== taskListId) continue
      const emit = this.sessionEmitters.get(channelKey)
      if (!emit) continue
      emit({ type: 'task_list', sessionId: channelKey, taskListId, tasks })
      return
    }
    // Team-mode (taskListId is a team name) and no matching uuid: silently
    // drop. Desktop renderer doesn't surface teams yet.
  }

  /** Read tasks from disk for an arbitrary task list id. Used by
   *  broadcastTaskList (caller passes the resolved engine taskListId) and
   *  the tasks:list IPC. */
  async readTasksForList(taskListId: string): Promise<TaskItem[]> {
    const raw = await engineListTasks(taskListId)
    return raw
      .filter((t: EngineTask) => !t.metadata?._internal)
      .map((t: EngineTask): TaskItem => ({
        id: t.id,
        subject: t.subject,
        description: t.description || undefined,
        activeForm: t.activeForm,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy ?? [],
      }))
  }

  /** Translate a renderer-facing sessionId (channelKey) into the engine
   *  task list id. For UI sessions the channelKey IS the uuid, so the input
   *  passes through. For channel sessions (wechat:*) the engine writes
   *  tasks under the uuid → look it up via the in-memory session entry. */
  async readTasksForSession(sessionId: string): Promise<TaskItem[]> {
    const entry = this.sessions.get(sessionId)
    const taskListId = entry?.uuid ?? sessionId
    return this.readTasksForList(taskListId)
  }

  private ensureSession(channelKey: string): SessionEntry {
    let entry = this.sessions.get(channelKey)
    if (entry) return entry
    // Orphan sessions (channelKey is already a uuid from the sidebar) must
    // reuse that uuid as-is. Writing a fresh mapping would point the entry
    // at a brand-new empty JSONL, and the user's messages would vanish from
    // the file they actually picked in the sidebar.
    const uuid = this.registry.resolveOrCreateUuid(channelKey)
    entry = {
      id: channelKey,
      // `New Chat` is a sentinel the renderer maps to tt('new_chat'). Shown only
      // until the first message is sent — after which listSessions reads the
      // real title (customTitle / firstPrompt) from the JSONL via enrichLogs.
      title: 'New Chat',
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
      uuid,
      streamedBlockTypes: new Map<string, Set<string>>(),
    } as SessionEntry
    this.sessions.set(channelKey, entry)
    return entry
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setConnectorManager(mgr: import('./connector-manager.js').ConnectorManager): void {
    this.connectors = mgr
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
    // 桌面端没有"主线程切 agent"的 UI，但 CC bootstrap 期望这个值被显式设过：
    // utils/hooks.ts 的 resolvedAgentType 会回退读 getMainThreadAgentType()，
    // 没初始化的话首个 hook 调用拿到的是上次进程残留值（dev 模式 hot-reload 易出问题）。
    setMainThreadAgentType(undefined)
    // AskUserQuestion: opt-in to preview markdown rendering so the tool prompt
    // includes the preview-field guidance and the renderer can show preview
    // snippets in a monospace box (see renderer/js/chat.js showAskUserQuestion).
    setQuestionPreviewFormat('markdown')

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
      const { servers: userServers } = await getAllMcpConfigs()
      // Merge Klaus built-in connector servers in memory (never written to
      // .mcp.json, so the MCP tab doesn't see them).
      const connectorServers = (this.connectors?.buildServers() ?? {}) as typeof userServers
      const servers = { ...userServers, ...connectorServers }
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

  getMcpStatus(): Array<{
    name: string
    status: string
    toolCount: number
    error?: string
    tools: Array<{ name: string; description?: string }>
  }> {
    return this.mcpState.clients.map(c => {
      const name = (c as any).name ?? 'unknown'
      const type = (c as any).type
      const tools = this.mcpState.tools
        .filter((t: any) => t.mcpInfo?.serverName === name)
        .map((t: any) => ({
          name: t.mcpInfo?.originalToolName || t.name || 'unknown',
          description: typeof t.description === 'string' ? t.description : undefined,
        }))
      return {
        name,
        status: type === 'connected' ? 'connected' : type === 'needs-auth' ? 'needs-auth' : type === 'pending' ? 'pending' : 'disconnected',
        toolCount: tools.length,
        error: type === 'failed' ? ((c as any).error || 'Connection failed') : undefined,
        tools,
      }
    })
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

  /**
   * Drop the memoized agent definitions cache so the next chat() reloads
   * `~/.claude/agents/*.md`, `<sessionDir>/.claude/agents/*.md` and plugin
   * agents from disk. Call after the user adds/edits/removes agent markdown
   * files (CC parity: plugins/cacheUtils.ts:45 clears it on /reload-plugins).
   * Doesn't affect in-flight chats — they hold their own snapshot.
   */
  reloadAgentDefinitions(): void {
    clearAgentDefinitionsCache()
  }

  /** Revoke persisted OAuth tokens for a given MCP server (SSE/HTTP only) */
  async revokeMcpAuth(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const { servers } = await getAllMcpConfigs()
      const cfg = servers[name] as any
      if (!cfg) return { ok: false, error: 'Server not found' }
      const type = cfg.type
      if (type !== 'sse' && type !== 'http') {
        return { ok: false, error: 'Only SSE/HTTP servers support auth reset' }
      }
      await revokeServerTokens(name, cfg)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
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

  /**
   * Create a brand-new conversation. Each UI-originated session is a
   * standalone uuid — no channelKey wrapper, no rotation — matching CC's
   * own `/clear` behavior where every new conversation is an independent
   * uuid with its own JSONL. Old conversations appear in the sidebar iff
   * their JSONL exists on disk; the user decides when to delete them.
   * Channel-originated sessions (wechat/qq/feishu/…) still go through
   * `ensureSession(channelKey)` via chat(), which keeps the channelKey →
   * uuid mapping so a given sender's history stays stitched together.
   */
  newSession(): SessionInfo {
    const uuid = randomUUID()
    const entry = this.ensureSession(uuid)
    entry.title = 'New Chat'
    return { id: entry.id, title: entry.title, createdAt: entry.createdAt, updatedAt: entry.updatedAt }
  }

  /**
   * Enumerate sessions via CC's own session scanning. For each lite log, we
   * run enrichLogs → tail-reads 128 KB per file to pull customTitle,
   * firstPrompt, tag, etc. Title precedence:
   *   1. customTitle (user-renamed, `saveCustomTitle` wrote it)
   *   2. firstPrompt (auto-derived from first user msg by CC's readLiteMetadata)
   *   3. 'Chat'
   * Cross-referenced with the registry so channel sessions show their
   * channelKey as the stable id (e.g. "wechat:o9cq..."), with UI sidebar
   * badge derived from the prefix.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const projectDir = getProjectDir(CANONICAL_CWD)
    const liteLogs = await getSessionFilesLite(projectDir).catch(() => [])
    const { logs } = await enrichLogs(liteLogs, 0, liteLogs.length).catch(
      () => ({ logs: liteLogs, nextIndex: liteLogs.length }),
    )
    const results: SessionInfo[] = []
    for (const log of logs) {
      const uuid = (log as any).sessionId as string
      const channelKey = this.registry.sessionKeyOf(uuid) ?? uuid
      const title =
        (log as any).customTitle
          || ((log as any).firstPrompt ? String((log as any).firstPrompt).slice(0, 50) : '')
          || 'Chat'
      results.push({
        id: channelKey,
        title,
        createdAt: new Date((log as any).created ?? 0).getTime() || 0,
        updatedAt: new Date((log as any).modified ?? 0).getTime() || 0,
      })
    }
    // Registry-only sessions (user hit "new chat" but hasn't sent a first
    // message yet — no JSONL on disk). Show them so the sidebar reflects the
    // fresh conversation slot; title is the sentinel `New Chat`.
    for (const [channelKey, entry] of this.sessions) {
      if (!results.some(r => r.id === channelKey)) {
        results.push({
          id: channelKey,
          title: entry.title,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSessionDir(sessionId: string): string {
    return sessionDirFor(sessionId)
  }

  deleteSession(sessionId: string, opts?: { wipeWorkspace?: boolean }): void {
    const entry = this.sessions.get(sessionId)
    const uuid = entry?.uuid ?? this.registry.lookupUuid(sessionId)
    // Stop the in-flight query first: set the tombstone so any event that
    // arrives in the window between here and the query's finally-block is
    // dropped by the writer, then fire the abort. Without this a late
    // recordTranscript would resurrect the JSONL we're about to unlink.
    if (entry) {
      entry.deleted = true
      entry.abortController?.abort()
    }
    const filePath = join(getProjectDir(CANONICAL_CWD), `${uuid}.jsonl`)
    if (existsSync(filePath)) {
      try { unlinkSync(filePath) } catch (err) { console.warn('[Engine] deleteSession unlink failed:', err) }
    }
    // sidecar 跟着 jsonl 一起清理 — 留着会让下次同 uuid 的 session（重建很罕见但
    // 理论上可能）读到陈旧的 thinking 时长。
    const sidecarPath = this.thinkingDurationsPath(uuid as any)
    if (existsSync(sidecarPath)) {
      try { unlinkSync(sidecarPath) } catch (err) { console.warn('[Engine] deleteSession unlink sidecar failed:', err) }
    }
    this.sessions.delete(sessionId)
    this.sessionEmitters.delete(sessionId)
    this.sessionPermissionEmitters.delete(sessionId)
    this.registry.forgetUuid(uuid)
    // Cascade: drop recorded artifacts for this session.
    try { this.store.deleteArtifactsBySession(sessionId) } catch {}
    // Cascade: drop the CC task list directory for this session. For
    // standalone sessions taskListId === uuid (CC fallback in getTaskListId),
    // so the dir is exclusive to this session. Team task lists (keyed by
    // team name) are shared and intentionally NOT cleaned here — destroying
    // a teammate's session shouldn't wipe the leader's shared task list.
    if (uuid) {
      try {
        const tasksDir = engineGetTasksDir(uuid as string)
        // Defense in depth: refuse to recurse-delete anything that isn't a
        // direct child of the tasks/ root, even though sanitizePathComponent
        // already strips path-traversal chars from the uuid input.
        if (dirname(tasksDir).endsWith('/tasks') && existsSync(tasksDir)) {
          rmSync(tasksDir, { recursive: true, force: true })
        }
      } catch (err) {
        console.warn('[Engine] deleteSession rm tasks dir failed:', err)
      }
    }
    // Optionally wipe the session's workspace directory and all its files.
    // Guard: never let this escape SESSIONS_DIR (defense against weird sessionIds).
    if (opts?.wipeWorkspace) {
      const dir = sessionDirFor(sessionId)
      if (dir.startsWith(SESSIONS_DIR + '/') && existsSync(dir)) {
        try { rmSync(dir, { recursive: true, force: true }) }
        catch (err) { console.warn('[Engine] deleteSession rm workspace failed:', err) }
      }
    }
    clearSystemPromptSections()
  }

  /**
   * Rename via CC's saveCustomTitle — appends a `custom-title` entry to the
   * session's JSONL so listSessions' enrichLogs can read it back. Same API
   * the CLI's /rename uses. Falls back gracefully if the session has no
   * transcript yet (still updates the in-memory entry for immediate UI).
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    const entry = this.ensureSession(sessionId)
    const uuid = entry.uuid
    const transcriptPath = join(getProjectDir(CANONICAL_CWD), `${uuid}.jsonl`)
    entry.title = title
    entry.updatedAt = Date.now()
    if (existsSync(transcriptPath)) {
      try {
        await saveCustomTitle(uuid as any, title, transcriptPath, 'user')
      } catch (err) {
        console.warn('[Engine] saveCustomTitle failed:', err)
      }
    }
  }

  /**
   * Load full transcript for a channel-key via CC's loadTranscriptFile.
   * Returns messages in chain order with original content blocks preserved —
   * renderer uses these to rebuild thinking folds / tool cards / file badges
   * exactly as the live stream showed them.
   */
  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const uuid = this.registry.lookupUuid(sessionId)
    const projectDir = getProjectDir(CANONICAL_CWD)
    const filePath = join(projectDir, `${uuid}.jsonl`)
    if (!existsSync(filePath)) return []
    try {
      // Walk ALL messages in file order (= append order = chronological).
      // We deliberately do NOT project past the latest compact boundary
      // here: the renderer needs the full history so the user can toggle
      // the "expand hidden history" pill (Qritor-style verbose mode).
      // Filtering happens in the renderer based on a per-session
      // showCompactedHistory flag.
      const { messages } = await loadTranscriptFile(filePath, { keepAllLeaves: true })

      // Sidecar (best-effort)：live 测的 thinking 时长 keyed by message.id。
      const thinkingDurationsByMsgId = this.readThinkingDurations(uuid)

      // First pass: collect tool_result payloads keyed by tool_use_id, so that
      // the second pass can attach the final answers back onto the matching
      // AskUserQuestion tool_use block (the interactive card is rebuilt from
      // this on history load). Tool_result content is either a raw string or
      // a content-block array containing a text block.
      const toolResultById = new Map<string, string>()
      for (const m of messages.values()) {
        if (m.type !== 'user') continue
        if ((m as any).isSidechain) continue
        const c = (m as any).message?.content
        if (!Array.isArray(c)) continue
        for (const b of c) {
          if (!b || b.type !== 'tool_result') continue
          const id = b.tool_use_id
          if (typeof id !== 'string') continue
          let text = ''
          if (typeof b.content === 'string') text = b.content
          else if (Array.isArray(b.content)) {
            text = b.content
              .filter((x: any) => x && x.type === 'text' && typeof x.text === 'string')
              .map((x: any) => x.text)
              .join('\n')
          }
          // 剥离 CC 引擎注入的 <system-reminder>（给模型的反恶意代码提示等）
          text = text.replace(SYSTEM_REMINDER_RE, '').trimEnd()
          if (text) toolResultById.set(id, text)
        }
      }

      const out: ChatMessage[] = []
      let i = 0
      // 同次 model 调用的 content block 会被 CC 拆成多条 assistant JSONL（一条 thinking
      // 一行、tool_use 又一行），共享同一 message.id。CC 自己在 normalizeMessagesForAPI
      // 里按 message.id 合并（messages.ts:2246）；getHistory 也得做这一步，否则连续两条
      // thinking 行会渲染成两个 fold（见 2026-04-29 用户反馈）。
      // Regexes for the slash-command breadcrumb trio. Pre-compute for the
      // hot loop. caveat is dropped entirely (model-only); command-input and
      // command-stdout are surfaced via ChatMessage.kind so the renderer can
      // draw them as a command pill / dim system stdout instead of a normal
      // user bubble. Same scheme CC's REPL uses.
      const RE_CAVEAT_TAG = new RegExp(`<${LOCAL_COMMAND_CAVEAT_TAG}>[\\s\\S]*?</${LOCAL_COMMAND_CAVEAT_TAG}>`)
      const RE_COMMAND_NAME = new RegExp(`<${COMMAND_NAME_TAG}>(.*?)</${COMMAND_NAME_TAG}>`)
      const RE_COMMAND_STDOUT = new RegExp(`<${LOCAL_COMMAND_STDOUT_TAG}>([\\s\\S]*?)</${LOCAL_COMMAND_STDOUT_TAG}>`)

      let lastAssistantMsgId: string | undefined
      for (const m of messages.values()) {
        // Compact boundary system messages → emit a compaction-pill entry so
        // the renderer can draw the marker AND filter pre-boundary messages
        // when the user has compacted-history collapsed (the default).
        if ((m as any).type === 'system' && (m as any).subtype === 'compact_boundary') {
          out.push({
            id: `${sessionId}-${i++}`,
            uuid: typeof (m as any).uuid === 'string' ? (m as any).uuid : undefined,
            role: 'user',
            text: '',
            timestamp: Date.parse((m as any).timestamp || '') || 0,
            kind: 'compaction',
            isCompactionStart: false,
            compactionTrigger: (m as any).compactMetadata?.trigger ?? 'manual',
          })
          lastAssistantMsgId = undefined
          continue
        }
        if (m.type !== 'user' && m.type !== 'assistant') continue
        // Subagent (Task tool) internals — don't render in the main transcript.
        if ((m as any).isSidechain) continue
        // NOTE: deliberately NOT skipping isVisibleInTranscriptOnly. CC's TUI
        // hides the compact summary in chat view (only Ctrl+O transcript
        // shows it) because terminals are cramped, but rich GUI surfaces
        // (VSCode extension, this desktop app) render it inline as a
        // collapsible labeled card — that's the whole point of running
        // compact, the user wants to see what came out of it.
        const content = (m as any).message?.content
        let blocks = Array.isArray(content) ? content : undefined
        // Skip user rows that are pure tool_result replies (the renderer's
        // tool cards on the assistant side already show the outcome).
        if (m.type === 'user' && blocks && blocks.length > 0
            && blocks.every((b: any) => b?.type === 'tool_result')) {
          continue
        }
        // Compact-related user-message dispatch.
        if (m.type === 'user') {
          const rawText = typeof content === 'string'
            ? content
            : blocks
              ? blocks.filter((b: any) => b && b.type === 'text').map((b: any) => b.text || '').join('')
              : ''
          // isCompactSummary → render as a labeled summary card.
          if ((m as any).isCompactSummary) {
            out.push({
              id: `${sessionId}-${i++}`,
              uuid: typeof (m as any).uuid === 'string' ? (m as any).uuid : undefined,
              role: 'user',
              text: rawText,
              timestamp: Date.parse((m as any).timestamp || '') || 0,
              kind: 'compact-summary',
            })
            lastAssistantMsgId = undefined
            continue
          }
          // Caveat / command-input / command-stdout breadcrumbs are still
          // persisted (they're how CC's loader picks up "compact happened
          // here") but the GUI substitutes a single compaction pill for the
          // whole bundle, so drop them from the rendered transcript.
          if (rawText && (RE_CAVEAT_TAG.test(rawText) ||
                          RE_COMMAND_NAME.test(rawText) ||
                          RE_COMMAND_STDOUT.test(rawText))) {
            continue
          }
        }
        // Attach tool_result content back onto the matching tool_use block so
        // the renderer can show the execution output in the expanded card.
        // AskUserQuestion is special-cased (rebuild interactive card).
        if (m.type === 'assistant' && blocks) {
          blocks = blocks.map((b: any) => {
            if (b?.type !== 'tool_use' || typeof b.id !== 'string') return b
            const resultText = toolResultById.get(b.id)
            if (!resultText) return b
            if (b.name === 'AskUserQuestion') {
              const res = parseAskUserQuestionResult(resultText)
              return { ...b, input: { ...b.input, __resolution: res } }
            }
            return { ...b, __result: resultText }
          })
        }
        const text = typeof content === 'string'
          ? content
          : blocks
            ? blocks.filter((b: any) => b && b.type === 'text').map((b: any) => b.text || '').join('')
            : ''
        // Drop fully-empty user bubbles (rare, but e.g. attachment-only rows
        // that didn't survive serialization would render as a blank box).
        if (m.type === 'user' && !text.trim() && !blocks?.length) {
          // 还要重置 lastAssistantMsgId — 但 user 行如果是 tool_result 会被前面跳过，
          // 这里走到说明是真的 user 输入或纯空，且当前不会破坏 assistant 合并连续性
          // （真的 user 行已经是不同 msgId 的边界）。
          continue
        }

        const msgId = m.type === 'assistant'
          ? ((m as any).message?.id as string | undefined)
          : undefined

        // 同 msgId 的连续 assistant 行：合并到上一条 entry，不新建。
        if (m.type === 'assistant' && msgId && msgId === lastAssistantMsgId && out.length > 0) {
          const prev = out[out.length - 1]!
          if (blocks && blocks.length > 0) {
            prev.contentBlocks = [...(prev.contentBlocks || []), ...blocks]
          }
          if (text) prev.text = (prev.text || '') + text
          continue
        }

        out.push({
          id: `${sessionId}-${i++}`,
          uuid: typeof (m as any).uuid === 'string' ? (m as any).uuid : undefined,
          role: (m as any).message?.role ?? m.type,
          text,
          contentBlocks: blocks,
          timestamp: Date.parse((m as any).timestamp || '') || 0,
          thinkingDurationMs: msgId ? thinkingDurationsByMsgId.get(msgId) : undefined,
        })
        lastAssistantMsgId = m.type === 'assistant' ? msgId : undefined
      }
      // No timestamp sort — JSONL is append-only so file order is already
      // chronological, and sorting by timestamp lets sub-second skew between
      // synthesized messages (compact breadcrumbs vs. the model-emitted
      // summary they precede) flip the UI order. File order is the truth.
      return out
    } catch (err) {
      console.warn('[Engine] getHistory failed:', err)
      return []
    }
  }

  /**
   * Sidecar JSON next to the JSONL: { [messageId]: durationMs }. Live measurement
   * happens in processStreamEvent; getHistory reads to restore "Thought for Xs"
   * on rebuild. Best-effort — corrupted/missing file just yields an empty map.
   */
  private thinkingDurationsPath(uuid: string): string {
    return join(getProjectDir(CANONICAL_CWD), `${uuid}.thinking-durations.json`)
  }

  private readThinkingDurations(uuid: string): Map<string, number> {
    const map = new Map<string, number>()
    if (!uuid) return map
    const path = this.thinkingDurationsPath(uuid)
    if (!existsSync(path)) return map
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'number' && Number.isFinite(v)) map.set(k, v)
        }
      }
    } catch (err) {
      console.warn('[Engine] thinking-durations read failed:', err)
    }
    return map
  }

  private writeThinkingDuration(uuid: string, msgId: string, durationMs: number): void {
    if (!uuid || !msgId) return
    const path = this.thinkingDurationsPath(uuid)
    let data: Record<string, number> = {}
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'))
        if (parsed && typeof parsed === 'object') data = parsed
      }
    } catch {}
    data[msgId] = durationMs
    try {
      writeFileSync(path, JSON.stringify(data))
    } catch (err) {
      console.warn('[Engine] thinking-durations write failed:', err)
    }
  }

  /**
   * Truncate a session's JSONL transcript at the line whose `uuid` matches
   * `targetUuid`. Everything from that line onward (the user message itself +
   * every assistant turn / tool result that followed) is dropped.
   *
   * This is two related operations sharing the same plumbing — `mode` picks:
   *
   *   - `'delete'`: pure conversation cut. Files on disk and the artifacts
   *     table are left untouched; the produced files outlive the deleted
   *     turns by design (user said "删除只删除对话").
   *
   *   - `'rewind'`: CC's /rewind semantics — conversation cut PLUS file-system
   *     rollback via `fileHistoryRewind` (engine snapshots files before each
   *     turn that edits them, keyed by the user-message uuid). The artifacts
   *     table is then rebuilt from the surviving transcript so panel rows
   *     don't dangle to files the rewind just deleted.
   *
   * Why we do the file rewind BEFORE truncating: the snapshot records
   * (`type: 'file-history-snapshot'`) live in the same JSONL — if the target
   * line lands above its snapshot record, truncation would orphan it.
   *
   * Implemented as a host-level splice on top of CC's append-only JSONL
   * without touching engine code: engine exposes `removeMessageByUuid` (single
   * line) and `fileHistoryRewind` (file-system part), but no public combined
   * "rewind to message" primitive. We compose them here.
   *
   * @param opts.returnText  When true, parse the about-to-be-deleted line and
   *   return its user-message text so the renderer can stuff it back into the
   *   input box for editing (the "rewind" UX path).
   */
  async truncateAtMessage(
    sessionId: string,
    targetUuid: string,
    opts: { returnText?: boolean; mode?: 'delete' | 'rewind' } = {},
  ): Promise<{ ok: boolean; text: string | null; reason?: string }> {
    const uuid = this.registry.lookupUuid(sessionId)
    if (!uuid || !targetUuid) return { ok: false, text: null, reason: 'no-session-or-uuid' }
    const filePath = join(getProjectDir(CANONICAL_CWD), `${uuid}.jsonl`)
    if (!existsSync(filePath)) return { ok: false, text: null, reason: 'no-transcript' }
    const mode = opts.mode ?? 'delete'

    // Refuse mid-stream — engine is actively writing to this JSONL, racing it
    // would leave the file half-spliced. Renderer also has a `busy` guard;
    // this is the server-side belt.
    if (this.sessions.get(sessionId)?.isRunning) {
      console.warn(`[Engine] truncateAtMessage refused — session ${sessionId} is running`)
      return { ok: false, text: null, reason: 'session-busy' }
    }

    // Phase 1: walk the transcript via the engine's own loader so we work on
    // parsed JS objects, not raw bytes. This is what unblocks the UTF-8 trap
    // a hand-rolled byte splice falls into — `loadTranscriptFile` returns a
    // Map<uuid, message> in file order, and we just collect the suffix.
    const { messages } = await loadTranscriptFile(filePath, { keepAllLeaves: true })
    const orderedUuids: string[] = []
    let target: any = null
    let inSuffix = false
    for (const m of messages.values()) {
      const u = (m as any).uuid
      if (typeof u !== 'string') continue
      if (!inSuffix && u === targetUuid) {
        target = m
        inSuffix = true
      }
      if (inSuffix) orderedUuids.push(u)
    }
    if (!target) {
      console.warn(`[Engine] truncateAtMessage: uuid ${targetUuid} not found`)
      return { ok: false, text: null, reason: 'uuid-not-found' }
    }
    // Only user-message lines are valid anchors — the renderer's UX contract
    // is "delete this user message + every reply that followed". If we ever
    // get an assistant uuid (a renderer bug), refuse instead of nuking half
    // the conversation.
    if ((target as any).type !== 'user') {
      console.error(
        `[Engine] truncateAtMessage refused — uuid ${targetUuid} `
        + `points at type=${(target as any).type}, not user`,
      )
      return { ok: false, text: null, reason: 'not-a-user-message' }
    }

    // Extract the user message text (rewind UX wants it back in the input box).
    let extractedText: string | null = null
    if (opts.returnText) {
      const c = (target as any).message?.content
      if (typeof c === 'string') extractedText = c
      else if (Array.isArray(c)) {
        extractedText = c
          .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
          .map((b: any) => b.text)
          .join('')
      }
    }

    // Phase 2 (rewind only): file-system rollback BEFORE we delete any lines —
    // `file-history-snapshot` records may live below the target inside the
    // suffix that's about to be cut. Read snapshots from the still-intact
    // transcript via loadTranscriptFile.
    if (mode === 'rewind') {
      try { await this.applyFileHistoryRewind(uuid, filePath, targetUuid) }
      catch (err) { console.warn('[Engine] file history rewind failed:', err) }
    }

    // Phase 3: delete each suffix line via the engine's own `removeMessageByUuid`.
    // - It uses byte-level searching internally (no UTF-8 surprises).
    // - Walking from the END means each call hits the "tail entry" fast path
    //   (single ftruncate, no rewrite).
    //
    // Three-step ambient ritual matters here:
    //  1. switchSession      → swap ambient sessionId so getTranscriptPath()
    //                          derives THIS session's file
    //  2. resetSessionFilePointer → clear any stale sessionFile cache from a
    //                          previous chat() call against another session
    //  3. adoptResumedSessionFile → SET sessionFile = getTranscriptPath().
    //                          Without this, removeMessageByUuid silently
    //                          bails (`if (sessionFile === null) return`) —
    //                          materializeSessionFile is normally lazy and
    //                          fires only on the next user/assistant write.
    //                          We're not writing, only deleting, so we have
    //                          to materialize it ourselves.
    switchSession(uuid as any, getProjectDir(CANONICAL_CWD))
    await resetSessionFilePointer()
    adoptResumedSessionFile()
    console.log(
      `[Engine] truncateAtMessage(${mode}) sessionId=${sessionId} `
      + `target=${targetUuid} dropping ${orderedUuids.length} message(s)`,
    )
    for (let i = orderedUuids.length - 1; i >= 0; i--) {
      try { await removeTranscriptMessage(orderedUuids[i] as any) }
      catch (err) { console.warn('[Engine] removeTranscriptMessage failed:', orderedUuids[i], err) }
    }

    // Drop in-memory session state so the next chat()/getHistory() loads from
    // the now-truncated transcript. SessionEntry holds a cached `messages[]`
    // that would otherwise carry the now-deleted turns into the next prompt.
    this.sessions.delete(sessionId)

    // Phase 4 (rewind only): rebuild the artifacts table. After file rewind
    // the files those records pointed to may have been deleted/reverted, so
    // a panel row pointing to a phantom file is worse than no row. For pure
    // delete we leave the table alone — the files still exist on disk, and
    // "delete touches only the conversation" is the explicit ask.
    if (mode === 'rewind') {
      try { await this.rebuildArtifactsFromTranscript(sessionId) }
      catch (err) { console.warn('[Engine] artifact rebuild failed:', err) }
    }

    return { ok: true, text: extractedText }
  }

  /**
   * Roll the file system back to the state captured before `targetUuid`'s
   * turn ran. Loads the JSONL's `file-history-snapshot` records, hands them
   * to `fileHistoryRestoreStateFromLog` to reconstruct an in-memory
   * `FileHistoryState`, then calls `fileHistoryRewind`.
   *
   * `fileHistoryRewind` resolves backup paths via the ambient session id
   * (`getSessionId()`), so we mirror chat()'s `switchSession(uuid, projectDir)`
   * to point the engine at this session before invoking it.
   */
  private async applyFileHistoryRewind(
    engineUuid: string,
    transcriptPath: string,
    targetUuid: string,
  ): Promise<void> {
    const { fileHistorySnapshots } = await loadTranscriptFile(transcriptPath, { keepAllLeaves: true })
    if (!fileHistorySnapshots || fileHistorySnapshots.size === 0) return
    const snapshotList: FileHistorySnapshot[] = []
    for (const m of fileHistorySnapshots.values()) {
      if (m?.snapshot) snapshotList.push(m.snapshot)
    }
    if (snapshotList.length === 0) return
    if (!snapshotList.some(s => s.messageId === targetUuid)) return

    let state: FileHistoryState = { snapshots: [], trackedFiles: new Set(), snapshotSequence: 0 }
    fileHistoryRestoreStateFromLog(snapshotList, (newState) => { state = newState })
    if (state.snapshots.length === 0) return // file history disabled — restore was a no-op

    const updateState = (updater: (prev: FileHistoryState) => FileHistoryState) => {
      state = updater(state)
    }
    // Backup files live under <claude-config>/file-history/<sessionId>/...,
    // resolved via getSessionId() unless overridden — point the engine at this
    // session the same way chat() does.
    switchSession(engineUuid as any, getProjectDir(CANONICAL_CWD))
    await fileHistoryRewind(updateState, targetUuid as any)
  }

  /**
   * Walk the on-disk transcript and re-populate `session_artifacts` to match.
   * Mirrors the live `tool_end → upsertArtifact` path: only non-error
   * tool_results count, and Write/Edit/NotebookEdit are the only artifact
   * producers. Per file path, the latest non-error op wins (matches the
   * `ON CONFLICT … last_op = excluded.last_op` upsert).
   */
  private async rebuildArtifactsFromTranscript(sessionId: string): Promise<void> {
    const uuid = this.registry.lookupUuid(sessionId)
    if (!uuid) return
    const filePath = join(getProjectDir(CANONICAL_CWD), `${uuid}.jsonl`)
    if (!existsSync(filePath)) {
      this.store.deleteArtifactsBySession(sessionId)
      return
    }
    const { messages } = await loadTranscriptFile(filePath, { keepAllLeaves: true })
    // First pass: index every tool_use by id across all assistant messages.
    const toolUseById = new Map<string, { name: string; input: Record<string, unknown> }>()
    for (const m of messages.values()) {
      if ((m as any).type !== 'assistant') continue
      const blocks = (m as any).message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b?.type === 'tool_use' && typeof b.id === 'string') {
          toolUseById.set(b.id, { name: b.name || '', input: (b.input ?? {}) as any })
        }
      }
    }
    // Second pass: for every successful tool_result, see if its tool_use was a
    // file-writer; collect filePath → op preserving append order so the last
    // write wins (the live path's upsert has the same effect).
    const ordered: Array<{ filePath: string; op: ArtifactOp }> = []
    for (const m of messages.values()) {
      if ((m as any).type !== 'user') continue
      if ((m as any).isSidechain) continue
      const blocks = (m as any).message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b?.type !== 'tool_result' || b.is_error) continue
        const tu = toolUseById.get(b.tool_use_id)
        if (!tu) continue
        if (tu.name === 'Write' || tu.name === 'Edit') {
          const fp = tu.input['file_path']
          if (typeof fp === 'string' && fp.length > 0) {
            ordered.push({ filePath: fp, op: tu.name === 'Write' ? 'write' : 'edit' })
          }
        } else if (tu.name === 'NotebookEdit') {
          const fp = tu.input['notebook_path']
          if (typeof fp === 'string' && fp.length > 0) {
            ordered.push({ filePath: fp, op: 'notebook_edit' })
          }
        }
      }
    }
    this.store.deleteArtifactsBySession(sessionId)
    for (const { filePath: fp, op } of ordered) {
      try { this.store.upsertArtifact(sessionId, fp, op) } catch {}
    }
  }

  // --- Chat ---

  async chat(
    sessionId: string,
    text: string,
    media?: any[],
    options?: {
      onEvent?: (event: EngineEvent) => void
      onPermissionRequest?: (req: PermissionRequest) => void
      /**
       * Whether to emit a `user_message` chat event after the user turn is
       * pushed. Desktop-UI chats already render the user bubble locally in
       * send() for 0-latency feedback, so they pass false. Channel handlers
       * (wechat / feishu / …) pass true — the renderer otherwise has no way
       * to know the remote user said something.
       */
      emitUserMessage?: boolean
    },
  ): Promise<string> {
    // Serialize all chats — CC session state is module-global (STATE.sessionId /
    // STATE.sessionProjectDir in bootstrap/state.ts), not AsyncLocalStorage.
    // Without this queue, concurrent wechat+UI chats would race `switchSession`
    // and cross-contaminate transcripts. FIFO matches the "one active chat at a
    // time" desktop UX the user described.
    const run = () => this.doChat(sessionId, text, media, options)
    const next = this.chatQueue.then(run, run)
    this.chatQueue = next.catch(() => {}) // isolate errors so queue keeps flowing
    return next
  }

  private async doChat(
    sessionId: string,
    text: string,
    _media: any[] | undefined,
    options?: {
      onEvent?: (event: EngineEvent) => void
      onPermissionRequest?: (req: PermissionRequest) => void
      emitUserMessage?: boolean
    },
  ): Promise<string> {
    // Register per-session forwarders. Only the caller that provided onEvent
    // receives stream events — aligns with Web 端 gateway.createAgentEventForwarder pattern.
    if (options?.onEvent) this.sessionEmitters.set(sessionId, options.onEvent)
    if (options?.onPermissionRequest) this.sessionPermissionEmitters.set(sessionId, options.onPermissionRequest)

    // Mirror channel context from channelKey → engine uuid gets set up below,
    // once the session entry (and therefore uuid) exists.
    let cronBridgeMod: typeof import('../engine/utils/klausCronBridge.js') | null = null
    let mirroredUuid: string | null = null
    const cleanupMirror = () => {
      if (mirroredUuid && cronBridgeMod) {
        try { cronBridgeMod.clearSessionChannelContext(mirroredUuid) } catch {}
      }
    }
    console.log('[Engine] chat() called', { sessionId, textLen: text?.length })
    // 等待引擎初始化完成（init 仍在后台进行时，chat 自然排队，用户感知不到）
    await this.init()
    console.log('[Engine] chat() init done, entering query')

    const session = this.ensureSession(sessionId)
    const uuid = session.uuid
    const projectDir = getProjectDir(CANONICAL_CWD)
    const transcriptPath = join(projectDir, `${uuid}.jsonl`)

    // Now that uuid is pinned, alias any channel context set by the handler
    // under the uuid so engine tools (CronCreate) can read it via STATE.sessionId.
    try {
      cronBridgeMod = await import('../engine/utils/klausCronBridge.js')
      const ctx = cronBridgeMod.getSessionChannelContext(sessionId)
      if (ctx && uuid && uuid !== sessionId) {
        cronBridgeMod.setSessionChannelContext(uuid, ctx)
        mirroredUuid = uuid
      }
    } catch {}

    // Swap CC's ambient session id / project dir → subsequent recordTranscript
    // calls will write to ~/.klaus/projects/<sanitized-canonical>/<uuid>.jsonl.
    //
    // Three-step ritual matches CC CLI's session-switch sequence:
    //  1. switchSession(uuid, projectDir) — atomically swap STATE.sessionId + STATE.sessionProjectDir
    //  2. resetSessionFilePointer() — drop Project.sessionFile cache so the next
    //     recordTranscript re-derives path from the new sessionId (see
    //     sessionStorage.ts:1369). Without this writes go to the previous jsonl.
    //  3. clearSessionMetadata() — drop Project.currentSession{Title,LastPrompt,Tag,...}
    //     caches carried over from the previous chat. materializeSessionFile() calls
    //     reAppendSessionMetadata() on first write (sessionStorage.ts:877), which
    //     would otherwise leak the previous session's last-prompt into this new
    //     session's jsonl head — causing the sidebar to show the wrong title.
    switchSession(uuid as any, projectDir)
    await resetSessionFilePointer()
    clearSessionMetadata()

    // Lazy-load history from CC's own JSONL. Uses buildConversationChain —
    // the same function --resume uses — so parentUuid chain and sibling
    // tool_result recovery are handled identically to the CLI. Without it
    // we'd be feeding query() raw Map-iteration order which can drop
    // parallel tool branches.
    if (session.messages.length === 0 && existsSync(transcriptPath)) {
      try {
        const { messages, leafUuids } = await loadTranscriptFile(transcriptPath, { keepAllLeaves: false })
        // Single-leaf main session (desktop never forks) — pick the one leaf.
        const leafUuid = leafUuids.values().next().value as string | undefined
        const leaf = leafUuid ? messages.get(leafUuid as any) : undefined
        if (leaf) {
          const chain = buildConversationChain(messages, leaf)
          for (const m of chain) {
            if (m.type !== 'user' && m.type !== 'assistant') continue
            session.messages.push(m as any)
          }
          // Seed the parent-chain cursor with the tail of restored history so
          // this turn's new messages link up to it rather than starting fresh.
          if (chain.length > 0 && !session.lastRecordedUuid) {
            session.lastRecordedUuid = (chain[chain.length - 1] as any).uuid
          }
          console.log(`[Engine] buildConversationChain → ${session.messages.length} message(s) for ${sessionId}`)
        }
      } catch (err) {
        console.warn('[Engine] Failed to load transcript:', err)
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
        this.pushEvent({ type: 'auth_required', sessionId, reason: 'not_logged_in', mode: 'subscription' })
        this.pushEvent({ type: 'done', sessionId })
        return ''
      }
    } else {
      const m = this.store.getDefaultModel() as any
      if (!m || !m.apiKey) {
        this.pushEvent({ type: 'auth_required', sessionId, reason: 'no_model', mode: 'custom' })
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

    // No explicit auto-title — CC writes the first user message to JSONL via
    // recordTranscript, then enrichLogs reads it back as `firstPrompt` which
    // listSessions uses as the default title. The engine handles this end to end.

    // Persist-from-index: marks the tail of session.messages before this turn's
    // user msg is pushed. After query() we append [startIdx..] to disk, which
    // is the exact slice the model added this turn (user + all assistant turns).
    let startIdx = 0

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
      //
      // Prompts source of truth is the Klaus cloud admin panel; local SQLite
      // is just an offline cache. Every turn we try cloud first and fall
      // back to local on any failure (network / 401 / bad payload).
      const promptRecords = await this.loadPromptRecords()
      const sectionOverrides: Record<string, string> = {}
      const customAppendSections: Array<{ name: string; content: string }> = []
      let cliPrefixOverride: string | null = null
      for (const prompt of promptRecords) {
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
      // Per-session cwd 必须在 getSystemPrompt 之前生效 — 系统提示里的 CWD: ${getCwd()}
      // 决定模型写文件时拼的绝对路径。否则会落到 init 时设的全局 fallback __default__。
      const sessionDir = sessionDirFor(sessionId)
      mkdirSync(sessionDir, { recursive: true })
      const systemPromptParts = await runWithCwdOverride(sessionDir, () => getSystemPrompt(
        tools as any,
        this.getModel(),
        undefined,
        this.mcpState.clients,
        sectionOverrides,
        undefined, // disabledSkills
        customAppendSections,
      ))
      const systemPrompt = asSystemPrompt(systemPromptParts)
      console.log('[Engine] systemPrompt built, parts=', systemPromptParts?.length)

      // CC main.tsx:2029 启动时调 getAgentDefinitionsWithOverrides(currentCwd) 拉
      // built-in agents (general-purpose / Explore / Plan / …) + 用户/项目 .claude/agents/*.md
      // + plugin agents。Klaus 桌面端必须保留这套，否则：
      //   - AgentTool.ts:344 在 activeAgents 里 find('general-purpose') 拿到 undefined
      //     → throw "Agent type 'general-purpose' not found"（截图里的失败）
      //   - AgentTool/prompt.ts:198 "Available agent types: " 列空，但同一 prompt 仍告诉
      //     模型"省略时用 general-purpose" → 模型按描述调用 → 必失败
      //   - WebSearchTool / spawnMultiAgent / ExitPlanMode 等读 activeAgents 的工具描述
      //     全部缺数据
      //   - getAgentDefinitionsWithOverrides 内部还串起了 plugin agents 加载与 agent
      //     memory snapshot 初始化 (loadAgentsDir.ts:347-354)，跳过等于把这两套也丢了
      //
      // memoize 按 cwd 缓存，同一 sessionDir 第二次 chat 命中缓存（无重复扫盘）；
      // 必须 runWithCwdOverride，因为内部 loadMarkdownFilesForSubdir('agents', cwd)
      // 用 cwd 解析 <cwd>/.claude/agents/*.md。
      const agentDefinitions = await runWithCwdOverride(
        sessionDir,
        () => getAgentDefinitionsWithOverrides(sessionDir),
      )
      if (agentDefinitions.failedFiles && agentDefinitions.failedFiles.length > 0) {
        for (const f of agentDefinitions.failedFiles) {
          console.warn(`[Engine] Failed to parse agent definition ${f.path}: ${f.error}`)
        }
      }
      console.log(
        '[Engine] agentDefinitions loaded:',
        `active=${agentDefinitions.activeAgents.length}`,
        `all=${agentDefinitions.allAgents.length}`,
      )

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

      // 把 EngineHost 外部维护的状态（MCP 连接、权限 ctx、agent 定义）同步进 session.appState，
      // 这样 getAppState 返回的始终是一份完整、最新的 AppState（结构对齐 CC getDefaultAppState）。
      // agentDefinitions 也写到 appState：AgentTool.tsx:501 的 mainThreadAgentDefinition
      // 解析、forkSubagent / spawnMultiAgent 的 allAgents lookup 都从 appState 读。
      session.appState = {
        ...session.appState,
        toolPermissionContext: toolPermissionCtx,
        agentDefinitions,
        mcp: {
          ...session.appState.mcp,
          clients: this.mcpState.clients,
          tools: this.mcpState.tools,
          resources: this.mcpState.resources,
        },
      }

      // Permission callback — routes to renderer via IPC
      const onAsk: OnAskCallback = async ({ tool: askTool, input: askInput, message, suggestions, toolUseContext, toolUseID }) => {
        // Klaus connector short-circuit: checkbox IS the permission.
        //   true  → tool checked by user → auto-allow
        //   false → tool unchecked → auto-deny
        //   null  → not a connector tool → fall through to normal flow
        const connectorAllowed = this.connectors?.isConnectorToolAllowed(askTool.name) ?? null
        if (connectorAllowed === true) return { decision: 'allow' as const }
        if (connectorAllowed === false) return { decision: 'deny' as const }

        // Loop detection
        const loopResult = session!.loopDetector.check({ toolName: askTool.name, args: askInput })
        if (loopResult?.block) {
          return { decision: 'deny' as const }
        }

        // Safety net: caller didn't register an onPermissionRequest forwarder.
        // pushPermissionRequest would silently no-op and onAsk would await
        // pendingPermissions forever — which deadlocks the global chatQueue
        // because CC's STATE.sessionId serializes every chat. Pre-emptively
        // deny so the engine moves on. Real interactive callers (UI chat:send,
        // cron-scheduler) MUST register an emitter; this branch fires only on
        // misconfiguration and prints a loud warning so it's findable.
        if (!this.sessionPermissionEmitters.has(sessionId)) {
          console.warn(
            `[Permission] No onPermissionRequest forwarder for session=${sessionId} ` +
            `tool=${askTool.name} → auto-denying. Caller must pass onPermissionRequest ` +
            `to engine.chat() or run with permission_mode=bypassPermissions.`,
          )
          return { decision: 'deny' as const }
        }

        const requestId = randomUUID()

        this.pushPermissionRequest(sessionId, {
          requestId,
          sessionId,
          toolName: askTool.name,
          toolInput: askInput,
          message,
          suggestions: suggestions?.map(s => ({ ...s } as any)),
          toolCallId: toolUseID,
        })

        // Wait for renderer response OR for the session's abort signal
        // (interrupt button). Without the abort hookup the promise hangs
        // forever when the user clicks stop while a question card is up,
        // because resolvePermission is only reachable via the renderer.
        const response = await new Promise<PermissionResponse>((resolve) => {
          const abortSignal = toolUseContext.abortController.signal
          const cleanupOnAbort = () => {
            if (!pendingPermissions.has(requestId)) return
            pendingPermissions.delete(requestId)
            // Tell the renderer to tear down its card so the user sees the
            // interrupt take effect immediately.
            this.pushEvent({ type: 'permission_cancelled', sessionId, requestId } as any)
            resolve({ decision: 'deny' })
          }
          if (abortSignal.aborted) {
            // Already aborted (e.g., race between abort and onAsk entry).
            cleanupOnAbort()
            return
          }
          abortSignal.addEventListener('abort', cleanupOnAbort, { once: true })
          pendingPermissions.set(requestId, {
            resolve: (resp) => {
              abortSignal.removeEventListener('abort', cleanupOnAbort)
              resolve(resp)
            },
          })
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

      // Stamp turn boundary before push. Everything session.messages[startIdx..]
      // is the new slice for this chat() call; we persist via recordTranscript
      // below (CC dedups by uuid so already-recorded replays are no-op).
      startIdx = session.messages.length
      // Append user message — persistence goes through CC's recordTranscript
      // right after (aligns with LocalMainSessionTask's per-message flush).
      const userMsg: Message = {
        type: 'user',
        message: { role: 'user', content: text },
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      } as any
      session.messages.push(userMsg)
      // Persist via CC API — writes to <projectDir>/<uuid>.jsonl, format
      // identical to CC CLI's sessions. Pass lastRecordedUuid so the user
      // turn's parentUuid chains to any restored history (or stays null if
      // this is the very first message), matching CC's recordTranscript
      // contract.
      if (!session.deleted) {
        try {
          const recorded = await recordTranscript([userMsg], undefined, session.lastRecordedUuid as any)
          session.lastRecordedUuid = (recorded as any) ?? userMsg.uuid
        } catch (err) {
          console.warn('[Engine] recordTranscript(user) failed:', err)
        }
      }
      // Notify UI about inbound user turns (channel scenarios). Desktop UI
      // chats already rendered the user bubble locally before calling chat().
      if (options?.emitUserMessage) {
        this.pushEvent({ type: 'user_message', sessionId, message: userMsg })
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
            // 与 session.appState.agentDefinitions 共享同一份引用，确保 AgentTool / WebSearchTool
            // / spawnMultiAgent 等所有读 toolUseContext.options.agentDefinitions 的工具拿到一致数据。
            agentDefinitions,
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
                this.pushEvent({ type: 'teammate_spawned', sessionId, agentId: id, name: task?.name ?? id, color: task?.color })
              }
              const prevTask = (prev.tasks as any)?.[id]
              const nextTask = (next.tasks as any)[id]
              if (prevTask && nextTask) {
                if (prevTask.toolUseCount !== nextTask.toolUseCount) {
                  this.pushEvent({ type: 'agent_progress', sessionId, agentId: id, toolUseCount: nextTask.toolUseCount ?? 0 })
                }
                if (prevTask.status !== nextTask.status && (nextTask.status === 'completed' || nextTask.status === 'failed')) {
                  this.pushEvent({ type: 'agent_done', sessionId, agentId: id, status: nextTask.status })
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

      // sessionDir 已在 getSystemPrompt 之前计算并 mkdir — 这里仅用于把 query() 也包进
      // runWithCwdOverride，让工具运行时 getCwd() 也指向 session 目录（JSONL/auto-memory 等）。
      console.log('[Engine] sessionDir=', sessionDir, 'model=', this.getModel(), 'authMode=', authMode, 'apiKey.len=', (modelRecord as any)?.apiKey?.length, 'baseURL=', (modelRecord as any)?.baseUrl)

      await runWithCwdOverride(sessionDir, async () => {
        console.log('[Engine] calling query()')
        const gen = query(queryParams)
        console.log('[Engine] query() returned generator, awaiting first event...')
        let n = 0
        for await (const event of gen) {
          n++
          console.log(`[Engine] event #${n}:`, (event as any)?.type)
          // Session was deleted mid-stream — stop processing so we don't
          // resurrect state or re-write the unlinked JSONL. The abort
          // signal should unwind the generator shortly; this guard is the
          // belt for the racing events already in flight.
          if (session.deleted) break
          this.processStreamEvent(sessionId, event as any, session)
          // Flush each new assistant/user message to CC's JSONL as it arrives
          // — mirrors LocalMainSessionTask's per-event recordSidechainTranscript.
          // lastRecordedUuid threads the parentUuid chain: each new message
          // points to the previous one's uuid so buildConversationChain can
          // walk the whole conversation on Cmd+R reload.
          const t = (event as any)?.type
          if (t === 'assistant' || t === 'user') {
            try {
              const recorded = await recordTranscript([event as any], undefined, session.lastRecordedUuid as any)
              session.lastRecordedUuid = (recorded as any) ?? (event as any).uuid ?? session.lastRecordedUuid
            } catch (err) {
              console.warn('[Engine] recordTranscript(' + t + ') failed:', err)
            }
          }
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
        this.pushEvent({ type: 'interrupted', sessionId })
      } else if (/Please run \/login|Not logged in|OAuth token revoked/i.test(msg)) {
        // 运行时识别 OAuth token 过期 / 被吊销，转成前端能渲染按钮的 auth_required 事件
        this.pushEvent({ type: 'auth_required', sessionId, reason: 'token_invalid', mode: authMode })
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
      cleanupMirror()
    }

    // Persistence already happened inside the for-await loop via
    // recordTranscript — nothing to do here. Just compute the reply text that
    // channel outbound adapters (wechat/telegram/…) need to deliver back to
    // the user.
    const newMsgs = session.messages.slice(startIdx)
    let returnText = ''
    const lastMsg = [...newMsgs].reverse().find(m => (m as any).type === 'assistant')
    if (lastMsg) {
      const content = (lastMsg as any).message?.content
      returnText = Array.isArray(content)
        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : typeof content === 'string' ? content : ''
    }
    return returnText
  }

  interrupt(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.abortController) return
    console.log(`[Engine] Interrupt requested for ${sessionId}`)
    // 对齐 CC REPL.tsx:2147：abortController.abort('user-cancel')
    session.abortController.abort('user-cancel')
  }

  // --- Context window snapshot (for monitor panel) ---

  /**
   * Snapshot the session's context-window usage by running CC's
   * `analyzeContextUsage` over the current message buffer. Also computes the
   * warning-state (until-auto-compact %, blocking-limit, etc.) using
   * `calculateTokenWarningState` so the renderer can color the bar without a
   * second round-trip.
   *
   * Returns null when the session doesn't exist; never throws (analyze can be
   * heavy — failures are caught and surfaced as null, the renderer falls back
   * to "—" cells).
   *
   * Cheap when called between turns; **don't** call this on every stream
   * delta — the renderer throttles to once per `done`/`compact_boundary`.
   */
  async getContextStats(sessionId: string): Promise<ContextStats | null> {
    const session = await this.getOrHydrateSession(sessionId)
    if (!session) return null
    try {
      const runtime = await this.buildOutOfTurnRuntime(session)
      // analyzeContextUsage's getCurrentUsage() walks messages from the tail
      // looking for the last assistant message with `usage` and reports its
      // input_tokens as the hero number. Klaus pushes Task-tool sub-agent
      // assistant messages onto the same session.messages array (with
      // isSidechain: true; see processStreamEvent), so during fork the tail
      // is "the sub-agent's first reply" — which has input_tokens ~= the
      // sub-agent's tiny prompt (e.g. 25), not the main session's. Hero
      // momentarily collapses from 88k → 25 until the next main-thread
      // assistant message lands.
      //
      // Fix: feed analyze the main-thread projection. Sidechain messages
      // don't reach the API on the main turn (normalizeMessagesForAPI
      // strips them) so excluding them from token accounting matches what
      // the model actually sees.
      const mainThreadMessages = session.messages.filter(m => !(m as any).isSidechain) as Message[]
      const data = await runWithCwdOverride(runtime.sessionDir, async () =>
        analyzeContextUsage(
          mainThreadMessages,
          runtime.model,
          async () => runtime.toolPermissionContext,
          runtime.tools as any,
          runtime.agentDefinitions,
          80,
          undefined,
          undefined,
          mainThreadMessages,
        ),
      )
      const warning = calculateTokenWarningState(data.totalTokens, runtime.model)
      const acThreshold = getAutoCompactThreshold(runtime.model)
      const stats: ContextStats = {
        model: data.model,
        tokens: data.totalTokens,
        maxTokens: data.maxTokens,
        rawMaxTokens: data.rawMaxTokens,
        percentage: data.percentage,
        effectiveWindow: getEffectiveContextWindowSize(runtime.model),
        autoCompactThreshold: Number.isFinite(acThreshold) ? acThreshold : null,
        isAutoCompactEnabled: isAutoCompactEnabled(),
        warning: {
          percentLeft: warning.percentLeft,
          isAboveWarningThreshold: warning.isAboveWarningThreshold,
          isAboveErrorThreshold: warning.isAboveErrorThreshold,
          isAboveAutoCompactThreshold: warning.isAboveAutoCompactThreshold,
          isAtBlockingLimit: warning.isAtBlockingLimit,
        },
        categories: data.categories.map(c => ({
          name: c.name,
          tokens: c.tokens,
          color: String(c.color),
          isDeferred: c.isDeferred,
        })),
        memoryFiles: data.memoryFiles.map(f => ({ name: f.path, tokens: f.tokens })),
        mcpTools: data.mcpTools.map(t => ({ name: `${t.serverName}:${t.name}`, tokens: t.tokens })),
        agents: data.agents.map(a => ({ name: a.agentType, tokens: a.tokens, source: String(a.source) })),
        skills: data.skills
          ? {
              tokens: data.skills.tokens,
              items: data.skills.skillFrontmatter.map(s => ({
                name: s.name,
                tokens: s.tokens,
                source: String(s.source),
              })),
            }
          : null,
        apiUsage: data.apiUsage,
      }
      return stats
    } catch (err) {
      console.warn('[Engine] getContextStats failed:', err)
      return null
    }
  }

  // --- Manual /compact (input-toolbar button) ---

  /**
   * Run the same compact pipeline that CC's `/compact` slash command runs,
   * but driven from main without going through CC's command dispatcher
   * (Klaus stubs `processSlashCommand`). Mirrors `commands/compact/compact.ts`:
   * project messages past the previous boundary, build cache-safe params,
   * call `compactConversation`, then run the post-compact cleanup chain
   * (suppress warning, clear lastSummarizedMessageId, runPostCompactCleanup,
   * markPostCompaction) before swapping in the summary+attachments and
   * persisting to JSONL.
   *
   * Refuses when the session is mid-turn — the in-flight query owns
   * `session.messages` and a concurrent rewrite would race the stream loop.
   */
  async compactSession(sessionId: string, customInstructions: string = ''): Promise<CompactSessionResult> {
    const session = await this.getOrHydrateSession(sessionId)
    if (!session) return { ok: false, error: 'Session not found' }
    if (session.isRunning) return { ok: false, error: 'Session is busy' }

    // Project the messages CC would compact over: post-snip, post-previous-
    // boundary view. REPL keeps the full scroll for UI but compact must not
    // re-summarize already-summarized history.
    const messagesForCompact = getMessagesAfterCompactBoundary(session.messages)
    if (messagesForCompact.length === 0) {
      return { ok: false, error: 'No messages to compact' }
    }

    // pushEvent fans out via this.sessionEmitters[sessionId], which is only
    // populated for the duration of an active chat() call. compactSession
    // runs out-of-turn (no chat() wrapping), so without a forwarder our
    // compaction_start / compact_boundary / compaction_end events would be
    // dropped on the floor — leaving the renderer's "compacting…" toast
    // hanging until the IPC promise resolves with the result row, which
    // produces the "toast and done row appear simultaneously" bug.
    //
    // Register a temp forwarder for this call's lifetime, scoped to the
    // mainWindow (channel sessions don't trigger desktop compact). Restore
    // any pre-existing forwarder in finally so we don't clobber a chat()
    // that registered before us (shouldn't happen — isRunning gate prevents
    // it — but defense in depth).
    const previousEmitter = this.sessionEmitters.get(sessionId)
    const tempEmitter = (event: EngineEvent) => {
      this.mainWindow?.webContents.send('chat:event', event)
    }
    this.sessionEmitters.set(sessionId, tempEmitter)

    const abortController = new AbortController()
    session.abortController = abortController
    session.isRunning = true
    this.pushEvent({ type: 'compaction_start', sessionId })

    try {
      const runtime = await this.buildOutOfTurnRuntime(session)

      const modelRecord = this.store.getDefaultModel()
      const authMode = (this.store.get('auth_mode') as any) ?? 'subscription'
      const thinkingConfig = { type: 'disabled' as const }

      // Sync session.appState so getAppState() returns the same view chat() would.
      // compactConversation reads appState.toolPermissionContext / agentDefinitions
      // for the summary-stream sub-call.
      session.appState = {
        ...session.appState,
        toolPermissionContext: runtime.toolPermissionContext,
        agentDefinitions: runtime.agentDefinitions,
        mcp: {
          ...session.appState.mcp,
          clients: this.mcpState.clients,
          tools: this.mcpState.tools,
          resources: this.mcpState.resources,
        },
      }

      // Minimal toolUseContext that compactConversation requires. Same shape
      // chat() builds, just with no-op stream-mode hooks (we surface progress
      // via the dedicated compaction_start/end events instead).
      const toolUseContext: any = {
        messages: messagesForCompact,
        setMessages: (_fn: (prev: Message[]) => Message[]) => {
          // compactConversation uses setMessages only to update its local view;
          // we replace session.messages wholesale after the call returns.
        },
        onChangeAPIKey: () => {},
        handleElicitation: async () => ({ action: 'decline' as const }),
        options: {
          commands: [],
          debug: false,
          mainLoopModel: runtime.model,
          tools: runtime.tools as any,
          verbose: false,
          thinkingConfig,
          mcpClients: this.mcpState.clients,
          mcpResources: this.mcpState.resources,
          ideInstallationStatus: null,
          isNonInteractiveSession: false,
          customSystemPrompt: undefined,
          appendSystemPrompt: undefined,
          agentDefinitions: runtime.agentDefinitions,
          theme: 'dark',
          maxBudgetUsd: undefined,
          hooksConfig: {},
        },
        abortController,
        readFileState: new Map() as any,
        nestedMemoryAttachmentTriggers: new Set<string>(),
        loadedNestedMemoryPaths: new Set<string>(),
        dynamicSkillDirTriggers: new Set<string>(),
        discoveredSkillNames: new Set<string>(),
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
        setSDKStatus: () => {},
        setStreamMode: () => {},
        onCompactProgress: () => {},
        contentReplacementState: session.contentReplacementState,
        apiKey: authMode === 'subscription' ? undefined : (modelRecord as any)?.apiKey,
        baseURL: authMode === 'subscription' ? undefined : ((modelRecord as any)?.baseUrl ?? undefined),
        getAppState: () => session.appState,
        setAppState: (fn: (prev: AppState) => AppState) => {
          session.appState = fn(session.appState)
        },
        querySource: 'compact' as any,
      }

      const cacheSafeParams: any = {
        systemPrompt: runtime.systemPrompt,
        userContext: { currentDate: new Date().toISOString().split('T')[0]! },
        systemContext: {},
        toolUseContext,
        forkContextMessages: messagesForCompact,
      }

      const result = await runWithCwdOverride(runtime.sessionDir, () =>
        compactConversation(
          messagesForCompact,
          toolUseContext,
          cacheSafeParams,
          false,
          customInstructions || undefined,
          false,
        ),
      )

      // CC's processSlashCommand persists three breadcrumbs (caveat,
      // /compact command, local-command-stdout) so reload / --resume can
      // show "the user ran compact here, this summary is what came of it"
      // (see processSlashCommand.tsx L682). Without them, the only visible
      // mark of compaction is the summary itself — a mysterious assistant
      // turn from nowhere. Klaus desktop has no slash command surface
      // (button click instead), so we synthesize the equivalent.
      //
      // Ordering: CC's buildPostCompactMessages places messagesToKeep
      // *after* summaryMessages, so a vanilla CC transcript reads
      //   [boundary, summary, /compact pill, stdout, ...].
      // That's correct from the model's perspective — the boundary marks
      // "everything before is now the summary; what follows is current" —
      // but it reads inverted to a desktop user, who expects natural chat
      // order: their command first, the response second. Compose the
      // post-compact view manually so the breadcrumbs sit *before* the
      // summary and the transcript reads /compact → stdout → summary.
      // CC's processSlashCommand inlines three breadcrumbs into messagesToKeep
      // when /compact returns (processSlashCommand.tsx L682). Mirror that 1:1
      // — same content, same insertion point — so the persisted transcript
      // looks identical to a CC TUI session. Order then comes from CC's
      // buildPostCompactMessages: [boundary, summary, messagesToKeep,
      // attachments, hookResults]. This places the summary user message
      // (isCompactSummary + isVisibleInTranscriptOnly) right after boundary
      // so the renderer's collapsible <CompactSummary>-equivalent card sits
      // at the top of the post-compact view, with the /compact + stdout
      // breadcrumbs immediately after — same shape as CC's chat screen.
      const stdoutText = 'Compacted'
      const breadcrumbs: Message[] = [
        createSyntheticUserCaveatMessage() as Message,
        engineCreateUserMessage({
          content: formatCommandInputTags('compact', customInstructions || ''),
        }) as Message,
        engineCreateUserMessage({
          content: `<${LOCAL_COMMAND_STDOUT_TAG}>${stdoutText}</${LOCAL_COMMAND_STDOUT_TAG}>`,
        }) as Message,
      ]
      const resultWithBreadcrumbs = {
        ...result,
        messagesToKeep: [...((result.messagesToKeep ?? []) as Message[]), ...breadcrumbs],
      }
      const postCompactMessages = buildPostCompactMessages(resultWithBreadcrumbs) as Message[]
      session.messages = postCompactMessages

      // Persist post-compact messages to JSONL so the next reload sees the
      // compacted history (recordTranscript dedups by uuid; compactConversation
      // mints fresh uuids for the summary).
      if (!session.deleted) {
        try {
          for (const msg of postCompactMessages) {
            const recorded = await recordTranscript([msg as any], undefined, session.lastRecordedUuid as any)
            session.lastRecordedUuid = (recorded as any) ?? (msg as any).uuid ?? session.lastRecordedUuid
          }
        } catch (err) {
          console.warn('[Engine] recordTranscript(post-compact) failed:', err)
        }
      }

      // Cleanup chain — order matches CC's commands/compact/compact.ts.
      setLastSummarizedMessageId(undefined)
      suppressCompactWarning()
      runPostCompactCleanup()
      markPostCompaction()

      // Push the compact_boundary event with the summary payload so the
      // renderer can mutate its cache state directly (event-driven, no
      // reload IPC needed). Mirrors qritor-desktop's AiAssistant flow:
      // start event puts a loading marker, boundary event flips marker
      // to done + appends the summary row. The renderer's cache stays
      // in sync with the JSONL because the same uuid is reused on both
      // sides.
      const summaryMsg = result.summaryMessages[0] as any
      const summaryRawContent = summaryMsg?.message?.content
      const summaryText = typeof summaryRawContent === 'string'
        ? summaryRawContent
        : Array.isArray(summaryRawContent)
          ? summaryRawContent
              .filter((b: any) => b && b.type === 'text')
              .map((b: any) => b.text || '')
              .join('\n')
          : ''
      this.pushEvent({
        type: 'compact_boundary',
        sessionId,
        summaryText,
        summaryUuid: summaryMsg?.uuid,
        trigger: 'manual',
      })

      const preTokens = result.preCompactTokenCount ?? 0
      const postTokens = result.truePostCompactTokenCount ?? result.postCompactTokenCount ?? tokenCountWithEstimation(session.messages)
      return { ok: true, preTokens, postTokens }
    } catch (err: any) {
      const error = err?.message ?? String(err)
      this.pushEvent({ type: 'compaction_error', sessionId, error })
      return { ok: false, error }
    } finally {
      session.isRunning = false
      if (session.abortController === abortController) session.abortController = null
      // Restore the prior emitter (or remove ours if none existed). Only
      // touch the slot if it's still the temp forwarder we installed —
      // otherwise something else has taken over and we shouldn't clobber it.
      if (this.sessionEmitters.get(sessionId) === tempEmitter) {
        if (previousEmitter) this.sessionEmitters.set(sessionId, previousEmitter)
        else this.sessionEmitters.delete(sessionId)
      }
    }
  }

  /**
   * Resolve a sessionId to an in-memory SessionEntry, lazy-loading from JSONL
   * if needed — same hydrate logic that `chat()` runs on its first turn after
   * a cold start (see line ~1331). Without this, opening a historical session
   * from the sidebar (where `this.sessions` was never seeded because chat()
   * hasn't run since boot) would make `getContextStats` / `compactSession`
   * see an empty buffer and report "no data" / "no messages to compact".
   *
   * Returns null when:
   *   - sessionId resolves to no transcript (truly unknown id)
   *   - no JSONL on disk yet (brand new chat with zero messages)
   *
   * Side effect: hydrated entries are inserted into the sessions Map so the
   * next chat() call reuses them instead of re-reading the JSONL.
   */
  private async getOrHydrateSession(sessionId: string): Promise<SessionEntry | null> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const uuid = this.registry.lookupUuid(sessionId)
    if (!uuid) return null
    const projectDir = getProjectDir(CANONICAL_CWD)
    const transcriptPath = join(projectDir, `${uuid}.jsonl`)
    if (!existsSync(transcriptPath)) return null

    // ensureSession is private; calling it here mints a fresh entry into the
    // Map with the right uuid binding, then we replay the chain into its
    // messages array. Mirrors chat()'s cold-start lazy-load 1:1.
    const session = this.ensureSession(sessionId)
    try {
      const { messages, leafUuids } = await loadTranscriptFile(transcriptPath, { keepAllLeaves: false })
      const leafUuid = leafUuids.values().next().value as string | undefined
      const leaf = leafUuid ? messages.get(leafUuid as any) : undefined
      if (leaf) {
        const chain = buildConversationChain(messages, leaf)
        for (const m of chain) {
          if (m.type !== 'user' && m.type !== 'assistant') continue
          session.messages.push(m as any)
        }
        if (chain.length > 0 && !session.lastRecordedUuid) {
          session.lastRecordedUuid = (chain[chain.length - 1] as any).uuid
        }
      }
    } catch (err) {
      console.warn('[Engine] hydrate session failed:', err)
    }
    return session
  }

  /**
   * Build the per-call runtime parts shared by getContextStats and
   * compactSession. Doesn't reload prompt records / CLI prefix overrides —
   * those affect only the live system prompt that the API sees, and using the
   * default system prompt for analyze/compact is fine (compact's summary fork
   * also uses the default; CC `commands/compact/compact.ts:getCacheSharingParams`
   * does the same thing).
   *
   * Reuses already-cached `session.appState.agentDefinitions` /
   * `session.toolPermissionContext` when available (set by the most recent
   * `chat()`), and rebuilds them otherwise (e.g. user opens monitor panel
   * before sending the first message).
   */
  private async buildOutOfTurnRuntime(session: SessionEntry): Promise<{
    sessionDir: string
    tools: Tool[]
    agentDefinitions: AppState['agentDefinitions']
    toolPermissionContext: ToolPermissionContext
    model: string
    systemPrompt: ReturnType<typeof asSystemPrompt>
  }> {
    const sessionDir = sessionDirFor(session.id)
    mkdirSync(sessionDir, { recursive: true })

    const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool'])
    const tools = [
      ...getAllBaseTools().filter((t: any) => t.isEnabled() && !MCP_RESOURCE_TOOLS.has(t.name)),
      ...this.mcpState.tools,
    ]

    let agentDefinitions = session.appState.agentDefinitions
    if (!agentDefinitions || agentDefinitions.activeAgents.length === 0) {
      agentDefinitions = await runWithCwdOverride(sessionDir, () =>
        getAgentDefinitionsWithOverrides(sessionDir),
      )
      session.appState = { ...session.appState, agentDefinitions }
    }

    let toolPermissionContext = session.toolPermissionContext
    if (!toolPermissionContext) {
      toolPermissionContext = {
        ...getEmptyToolPermissionContext(),
        mode: (this.store.get('permission_mode') as any) ?? 'default',
        isBypassPermissionsModeAvailable: true,
        shouldAvoidPermissionPrompts: false,
      }
      try {
        const rules = loadAllPermissionRulesFromDisk()
        if (rules.length > 0) {
          toolPermissionContext = applyPermissionRulesToPermissionContext(toolPermissionContext, rules)
        }
      } catch {}
      session.toolPermissionContext = toolPermissionContext
    }

    const model = this.getModel()
    const systemPromptParts = await runWithCwdOverride(sessionDir, () =>
      getSystemPrompt(tools as any, model, undefined, this.mcpState.clients),
    )
    const systemPrompt = asSystemPrompt(systemPromptParts)

    return {
      sessionDir,
      tools,
      agentDefinitions,
      toolPermissionContext,
      model,
      systemPrompt,
    }
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
    if (this.taskListUnsubscribe) {
      try { this.taskListUnsubscribe() } catch {}
      this.taskListUnsubscribe = null
    }
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

  /**
   * Pull prompt records from the Klaus cloud (source of truth) and refresh
   * the local SQLite cache on success. On any failure (not logged in,
   * network, 401, malformed payload) fall back to whatever the cache has.
   *
   * The cache is what keeps chat working offline / while the backend is
   * down. It gets seeded the first time a fetch succeeds after login.
   */
  private async loadPromptRecords(): Promise<Array<{ id: string; name: string; content: string }>> {
    try {
      const { apiGet } = await import('./klaus-auth.js')
      const resp = await apiGet<{ prompts: Array<{ id: string; name: string; content: string; isDefault?: boolean; createdAt?: number; updatedAt?: number }> }>('/api/prompts')
      if (resp?.prompts && Array.isArray(resp.prompts)) {
        // Refresh local cache: wipe then re-insert (a simple mirror, not merge)
        try {
          this.store.replaceAllPrompts(resp.prompts)
        } catch (err) {
          console.warn('[Engine] failed to refresh prompts cache:', err)
        }
        return resp.prompts
      }
    } catch (err) {
      console.warn('[Engine] cloud prompts fetch failed, using cache:', err)
    }
    return this.store.listPrompts()
  }

  private processStreamEvent(sessionId: string, event: any, session: SessionEntry): void {
    if (!event || !event.type) return

    switch (event.type) {
      // 引擎发起 API 请求
      case 'stream_request_start': {
        this.pushEvent({ type: 'stream_mode', sessionId, mode: 'requesting' })
        this.pushEvent({ type: 'requesting', sessionId })
        // 思考时长测量起点：本次 model 调用的开始。CC JSONL 不记 duration，所以在
        // 这里打本地时间戳，下游 case 'assistant' 收到首个非 thinking block 时算 elapsed。
        session.streamThinkingStartTs = Date.now()
        session.sawThinkingInResponse = false
        break
      }

      // 完整的 assistant 消息 —— 把里面的 content 块拆成 UI 能渲染的事件
      // 是否兜底由 partial stream 是否推过这种 block 决定（streamedBlockTypes 按 msgId × blockType 记录）：
      // - 官方 API / Anthropic SDK 直连：partial 流已经推过 text/thinking/tool_use，这里全部跳过
      //   避免双倍渲染（典型如思考内容会重复成两段）。
      // - kimi-code / 部分 Bedrock 代理：只发完整 assistant 不发 partial，map 为空，全部兜底补发。
      // - redacted_thinking 这类 partial 流不处理的类型 → map 永远不会记录 → 总是兜底，符合预期。
      // - 未来 Anthropic 新增 block 类型只要在 partial 流里把 type 记进 map，兜底自动跟上。
      case 'assistant': {
        session.messages.push(event as Message)
        const msgId = (event as any).message?.id as string | undefined
        const streamed = msgId ? session.streamedBlockTypes.get(msgId) : undefined
        const wasStreamed = (t: string) => !!streamed?.has(t)
        const content = (event as any).message?.content
        // 思考时长测量：扫一眼这条消息里的 block 类型，决定是 mark sawThinking 还是 flush。
        // 同 msgId 可能被 CC 拆成多条 assistant JSONL（连续 thinking 行 + tool_use 行），
        // sawThinkingInResponse 跨多次 case 'assistant' 累计；遇到首个非 thinking block 才落盘。
        if (Array.isArray(content) && msgId && session.streamThinkingStartTs != null) {
          const hasThinking = content.some((b: any) => b?.type === 'thinking' || b?.type === 'redacted_thinking')
          const hasNonThinking = content.some((b: any) => b && b.type !== 'thinking' && b.type !== 'redacted_thinking')
          if (hasThinking) session.sawThinkingInResponse = true
          if (hasNonThinking && session.sawThinkingInResponse) {
            const elapsedMs = Math.max(0, Date.now() - session.streamThinkingStartTs)
            this.writeThinkingDuration(session.uuid, msgId, elapsedMs)
            session.streamThinkingStartTs = undefined
            session.sawThinkingInResponse = false
          }
        }
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text && !wasStreamed('text')) {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'responding' })
              this.pushEvent({ type: 'text_delta', sessionId, text: block.text })
            } else if ((block.type === 'thinking' || block.type === 'redacted_thinking') && (block.thinking || block.data) && !wasStreamed(block.type)) {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'thinking' })
              this.pushEvent({ type: 'thinking_delta', sessionId, thinking: block.thinking ?? block.data ?? '' })
            } else if (block.type === 'tool_use') {
              this.pushEvent({ type: 'stream_mode', sessionId, mode: 'tool-use' })
              // partial 流已经凭 content_block_start 创建了卡片（args 为空，input_json_delta 前端忽略）
              // —— 跳过重复 tool_start 避免出现两张同 id 卡片。
              if (!wasStreamed('tool_use')) {
                this.pushEvent({
                  type: 'tool_start', sessionId,
                  toolName: block.name ?? '', toolCallId: block.id ?? '', args: block.input ?? {},
                })
              }
              // 始终把完整 input 作为 JSON 推一次：partial 流没推过时这是首次填充，
              // partial 流推过时它会让前端把空 args 卡片更新成真实 args（覆盖 input_json_delta 的碎片）。
              if (block.input) {
                this.pushEvent({
                  type: 'tool_input_delta', sessionId,
                  toolCallId: block.id ?? '',
                  delta: JSON.stringify(block.input),
                })
              }
            }
          }
        }
        this.pushEvent({ type: 'message_complete', sessionId, message: event })
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
                content: stringifyToolResultContent((block as any).content),
              })
              // Track Write/Edit/NotebookEdit artifacts on success.
              if (block.is_error) continue
              const found = findArtifactFromToolUse(session.messages, block.tool_use_id)
              if (!found) continue
              try {
                const rec = this.store.upsertArtifact(sessionId, found.filePath, found.op)
                this.pushEvent({
                  type: 'artifact', sessionId,
                  filePath: rec.filePath,
                  fileName: pathBasename(rec.filePath),
                  lastOp: rec.lastOp,
                  firstSeenAt: rec.firstSeenAt,
                  lastModifiedAt: rec.lastModifiedAt,
                })
              } catch (err) {
                console.error('[Artifact] upsert failed:', err)
              }
            }
          }
        }
        break
      }

      // API 原始流式事件（includePartialMessages=true 时才会有；桌面端目前 false，基本不会走到）
      case 'stream_event': {
        const se = event.event ?? event
        this.processApiStreamEvent(sessionId, se, session)
        break
      }

      // 系统消息：压缩边界 / API 错误 / 重试
      case 'system': {
        if (event.subtype === 'compact_boundary') {
          this.pushEvent({ type: 'compaction_end', sessionId })
          this.pushEvent({ type: 'compact_boundary', sessionId })
        } else if (event.subtype === 'api_error') {
          this.pushEvent({
            type: 'api_error', sessionId,
            error: event.error?.message ?? 'API error',
          })
          this.pushEvent({
            type: 'api_retry', sessionId,
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
        this.pushEvent({ type: 'tombstone', sessionId, messageUuid: event.messageUuid ?? event.uuid ?? '' })
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
        this.pushEvent({ type: 'file', sessionId, name: event.name, url: event.url })
        break
      }
    }
  }

  private processApiStreamEvent(sessionId: string, event: any, session: SessionEntry): void {
    if (!event?.type) return

    // 凡是这条 message 在 partial 流里出现过任意一种 block，就记到 streamedBlockTypes 里，
    // 让 case 'assistant' 知道哪些 block 已经推过、哪些需要兜底。统一从 content_block_start
    // 入手（每种 block 都会先发 start 再发 delta），加 delta 那一层只是双保险。
    const markStreamed = (blockType: string) => {
      const msgId = session.currentStreamingMessageId
      if (!msgId || !blockType) return
      let s = session.streamedBlockTypes.get(msgId)
      if (!s) { s = new Set<string>(); session.streamedBlockTypes.set(msgId, s) }
      s.add(blockType)
    }

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (block?.type) markStreamed(block.type)
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
          markStreamed('text')
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          this.pushEvent({ type: 'thinking_delta', sessionId, thinking: delta.thinking })
          markStreamed('thinking')
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          this.pushEvent({
            type: 'tool_input_delta', sessionId,
            toolCallId: '', delta: delta.partial_json,
          })
          markStreamed('tool_use')
        }
        break
      }
      case 'message_start': {
        this.pushEvent({ type: 'stream_mode', sessionId, mode: 'requesting' })
        session.currentStreamingMessageId = event.message?.id ?? undefined
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

}
