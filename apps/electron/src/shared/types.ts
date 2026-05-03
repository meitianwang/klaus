// IPC message types shared between main and renderer

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  /** CC-engine UUID of the underlying transcript line. Used by chat:rewind-from
   *  / chat:delete-from to address a specific message for truncation. May be
   *  undefined for legacy entries that lacked a uuid in the source JSONL. */
  uuid?: string
  role: 'user' | 'assistant'
  text: string
  // When present, carries the original engine Message.content block array
  // (thinking / text / tool_use / tool_result) so the renderer can
  // reconstruct rich UI (thinking folds, tool cards, file badges) on
  // Cmd+R restore. Legacy entries without blocks fall back to `text`.
  contentBlocks?: any[]
  thinking?: string
  toolCalls?: ToolCallInfo[]
  timestamp: number
  /** Live-measured thinking duration (ms) keyed by message.id, persisted to a
   *  sidecar JSON next to the JSONL. Restored sessions use this to show
   *  "Thought for Xs" matching the original live render. Undefined for legacy
   *  transcripts written before this was tracked, or when the assistant turn
   *  had no thinking block — the renderer falls back to "…" in that case. */
  thinkingDurationMs?: number
  /**
   * Special-render kinds for transcript entries that aren't a normal user/
   * assistant bubble. The compact lifecycle borrows Qritor's GUI-native
   * grammar (see qritor-desktop AiAssistant): a compaction marker pill
   * stands in for the operation, and the summary is its own labeled
   * card. The pill alone — not /compact + stdout breadcrumbs — is the
   * visual record of "compact happened here."
   *
   *   'compaction'       → boundary marker pill. Loading state shows a
   *                        spinner + "compacting…"; done state shows
   *                        "click to expand/collapse hidden history."
   *                        Click toggles the showCompactedHistory state
   *                        in the renderer.
   *   'compact-summary'  → user message with isCompactSummary set; renders
   *                        as a labeled card (title "Compact summary" +
   *                        max-height collapsible body — *not* one-line
   *                        title-only by default, since GUI has the
   *                        screen real estate CC TUI lacks).
   * Default (undefined) means a regular bubble.
   */
  kind?: 'compaction' | 'compact-summary'
  /** kind === 'compaction' only — true while the compact run is still
   *  in flight (loading pill), false once boundary marker is persisted. */
  isCompactionStart?: boolean
  /** kind === 'compaction' only — drives the loading-state label
   *  ("compacting…" vs. "auto-compacting…"). */
  compactionTrigger?: 'manual' | 'auto'
}

export interface ToolCallInfo {
  toolName: string
  toolCallId: string
  args: unknown
  result?: string
  isError?: boolean
}

export interface ModelRecord {
  id: string
  name: string
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  maxContextTokens: number
  thinking: string
  isDefault: boolean
  costInput?: number
  costOutput?: number
  costCacheRead?: number
  costCacheWrite?: number
  authType?: string
  refreshToken?: string
  tokenExpiresAt?: number
  role?: string
  createdAt: number
  updatedAt: number
}

export interface PromptRecord {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface CronChannelBinding {
  /** Plugin id — 'feishu' | 'dingtalk' | 'telegram' | 'wechat' | 'wecom' | 'qq' | 'whatsapp' */
  channelId: string
  /** Multi-account key, 'default' unless the user runs multiple accounts. */
  accountId?: string
  /** user_id for DMs, group_id for groups — the chat the run output gets pushed to. */
  targetId: string
  chatType: 'direct' | 'group'
  /** Feishu/DingTalk thread id when the origin was a thread. */
  threadId?: string
  /** Human-facing label cached at bind time ("@张三" / "群·产品日报"). Display-only. */
  label?: string
}

export interface CronTask {
  id: string
  name?: string
  description?: string
  schedule: string
  prompt: string
  enabled: boolean
  thinking?: string
  timeoutSeconds?: number
  deleteAfterRun?: boolean
  timezone?: string
  /** IM delivery binding. Populated for manual tasks that opted in (target = owner) or for tasks created from an IM conversation (target = that conversation). Absent = in-app only. */
  channelBinding?: CronChannelBinding
  /** How the task got into the DB — 'manual' | 'klaus_chat' | 'im_inbound'. Mostly for display so the management card can show provenance. */
  createdBy?: 'manual' | 'klaus_chat' | 'im_inbound'
  createdAt: number
  updatedAt: number
}

export type CronRunTrigger = 'scheduled' | 'manual'
export type CronRunStatus = 'running' | 'success' | 'failed'

export interface CronRun {
  id: number
  taskId: string
  taskName: string
  sessionId: string
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
  triggerType: CronRunTrigger
  status: CronRunStatus
  error: string | null
}

export interface CronRunFilters {
  limit?: number
  offset?: number
  taskId?: string
  status?: CronRunStatus
}

export interface MediaFile {
  type: string
  path: string
  name: string
}

// Engine events pushed from main → renderer
export type EngineEvent =
  | { type: 'text_delta'; sessionId: string; text: string }
  | { type: 'thinking_delta'; sessionId: string; thinking: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool_end'; sessionId: string; toolName: string; toolCallId: string; isError: boolean; content: string }
  | { type: 'tool_input_delta'; sessionId: string; toolCallId: string; delta: string }
  | { type: 'progress'; sessionId: string; toolName: string; toolCallId: string; content: string }
  | { type: 'stream_mode'; sessionId: string; mode: string }
  | { type: 'message_complete'; sessionId: string; message?: unknown }
  | { type: 'context_collapse_stats'; sessionId: string; collapsedSpans: number; stagedSpans: number }
  | { type: 'api_error'; sessionId: string; error: string }
  | { type: 'api_retry'; sessionId: string; attempt: number; maxRetries: number; delayMs: number; error?: string }
  | { type: 'auth_required'; sessionId: string; reason: string; mode: string }
  | { type: 'user_message'; sessionId: string; message: unknown }
  | { type: 'teammate_spawned'; sessionId: string; agentId: string; name?: string; color?: string }
  | { type: 'agent_progress'; sessionId: string; agentId: string; toolUseCount: number }
  | { type: 'agent_done'; sessionId: string; agentId: string; status: string }
  // Authoritative snapshot of session.appState.tasks. Renderer uses this as
  // the single source of truth for the agent panel. Replaces the event-driven
  // pattern (teammate_spawned/agent_progress/agent_done) where missed events
  // could leave the panel stuck in stale state. Pushed whenever the tasks
  // Record actually changes (sanitized, only serializable fields), and once
  // on session emitter registration so the panel hydrates immediately.
  | { type: 'tasks_changed'; sessionId: string; tasks: Record<string, AgentTaskSnapshot> }
  // Processed transcript for an in_process_teammate captured at the moment it
  // transitions to a terminal status (before messages are stripped / task evicted).
  // Renderer caches this in tasksBySession and persists it to the agent-tasks sidecar.
  | { type: 'teammate_messages'; sessionId: string; taskId: string; messages: unknown[] }
  | { type: 'interrupted'; sessionId: string }
  | { type: 'requesting'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  // Compact lifecycle events. Event-driven (not reload-based): the renderer
  // mutates its in-memory ChatMessage[] cache directly on each event and
  // re-renders. Mirrors qritor-desktop's AiAssistant compact stream.
  //   compaction_start → renderer pushes a kind:'compaction' marker
  //                      with isCompactionStart:true (loading pill).
  //   compact_boundary → engine signals completion; renderer flips the
  //                      marker to isCompactionStart:false AND pushes the
  //                      summary message into the cache. summaryText is
  //                      the model's compact summary content; summaryUuid
  //                      pins it to the JSONL row so reload sees the same.
  //   compaction_error → engine raised; renderer drops the loading marker.
  | { type: 'compact_boundary'; sessionId: string; summaryText?: string; summaryUuid?: string; trigger?: 'manual' | 'auto' }
  | { type: 'tombstone'; sessionId: string; messageUuid: string }
  | { type: 'compaction_start'; sessionId: string; trigger?: 'manual' | 'auto' }
  | { type: 'compaction_error'; sessionId: string; error: string }
  | { type: 'file'; sessionId: string; name?: string; url?: string }
  | { type: 'team_created'; sessionId: string; teamName: string }
  | { type: 'mcp_auth_url'; sessionId: string; url?: string; serverName?: string }
  | { type: 'permission_cancelled'; sessionId: string; requestId: string }
  | { type: 'done'; sessionId: string }
  | { type: 'artifact'; sessionId: string; filePath: string; fileName: string; lastOp: ArtifactOp; firstSeenAt: number; lastModifiedAt: number }
  // Mirrors CC's TaskListV2 panel data feed. Engine fires onTasksUpdated when
  // any TaskCreate/TaskUpdate writes to disk; engine-host snapshots the list
  // and broadcasts to the matching session emitter so the renderer panel
  // re-renders without polling.
  | { type: 'task_list'; sessionId: string; taskListId: string; tasks: TaskItem[] }

export interface TaskItem {
  id: string
  subject: string
  description?: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blockedBy: string[]
  /** Internal tasks (created by orchestrator helpers) are filtered out. */
  internal?: boolean
}

/**
 * Sanitized, serializable view of a session's appState.tasks[id] entry.
 * Mirrors CC's BackgroundTask data feed: the renderer uses this snapshot as
 * its single source of truth for the agent / teammate panel, so missed
 * incremental events (teammate_spawned / agent_progress / agent_done) can
 * never leave the UI stuck. Field set is the union of LocalAgentTaskState
 * and InProcessTeammateTaskState public bits — non-serializable members
 * (abortController, callbacks, full Message[] history) are intentionally
 * omitted; the messages list goes through getHistory's sub-agent projection
 * (阶段 D) when the user opens the teammate transcript view.
 */
export interface AgentTaskSnapshot {
  id: string
  /** TaskType (local_agent / in_process_teammate / local_bash / …) */
  type: string
  /** TaskStatus (pending / running / completed / failed / killed / cancelled) */
  status: string
  description: string
  startTime: number
  endTime?: number
  notified: boolean
  // CC lifecycle fields — see Task.ts / LocalAgentTask.ts
  evictAfter?: number
  retain?: boolean
  // local_agent-specific
  agentType?: string
  agentId?: string
  isBackgrounded?: boolean
  toolUseCount?: number
  error?: string
  resultText?: string
  // in_process_teammate-specific (identity is the team-scoped name)
  agentName?: string
  teamName?: string
  color?: string
  /** true when the teammate finished its work turn and is polling for new work */
  isIdle?: boolean
}

export type ArtifactOp = 'write' | 'edit' | 'notebook_edit'

export interface ArtifactRecord {
  readonly sessionId: string
  readonly filePath: string
  readonly lastOp: ArtifactOp
  readonly firstSeenAt: number
  readonly lastModifiedAt: number
}

export interface PermissionRequest {
  requestId: string
  /** Session that triggered this permission ask. Renderer routes the card to
   *  this session's DOM (current view → messagesEl directly; off-screen
   *  session → that session's sessionDom fragment so the card materializes
   *  when the user switches to it). Required since cron-run sessions can
   *  trigger permission asks while the user is looking at a different chat. */
  sessionId: string
  toolName: string
  toolInput: unknown
  message: string
  suggestions?: PermissionSuggestion[]
  /** Matches the tool_use block id so the renderer can attach UI (e.g. the
   *  AskUserQuestion card) adjacent to the tool-item instead of appending it
   *  to the end of the message list. */
  toolCallId?: string
}

export interface PermissionSuggestion {
  type: string
  rules?: Array<{ toolName: string; ruleContent?: string }>
  behavior?: string
  label?: string
  destination?: string
}

export interface PermissionResponse {
  decision: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  acceptedSuggestionIndices?: number[]
}

export interface EngineStatus {
  status: 'initializing' | 'ready' | 'error'
  error?: string
}

/**
 * Snapshot of a session's context window — the renderer's monitor panel
 * uses this to draw the token bar + category breakdown. Mirrors a subset
 * of CC engine's `analyzeContextUsage` ContextData, projected to the fields
 * the desktop UI actually renders so the IPC payload stays small.
 */
export interface ContextStatsItem {
  readonly name: string
  readonly tokens: number
  readonly source?: string
}
export interface ContextStatsCategory {
  readonly name: string
  readonly tokens: number
  /** CC theme-color key (e.g. "permission", "warning"). Renderer maps to a CSS color. */
  readonly color: string
  readonly isDeferred?: boolean
}
export interface ContextStats {
  readonly model: string
  readonly tokens: number
  /** Effective context window (may shrink after auto-compact buffer reservation). */
  readonly maxTokens: number
  /** Raw model context window before any reservation. */
  readonly rawMaxTokens: number
  readonly percentage: number
  readonly effectiveWindow: number
  readonly autoCompactThreshold: number | null
  readonly isAutoCompactEnabled: boolean
  /** Same fields as CC's calculateTokenWarningState — drives bar color + warning text. */
  readonly warning: {
    percentLeft: number
    isAboveWarningThreshold: boolean
    isAboveErrorThreshold: boolean
    isAboveAutoCompactThreshold: boolean
    isAtBlockingLimit: boolean
  }
  readonly categories: ContextStatsCategory[]
  readonly memoryFiles: ContextStatsItem[]
  readonly mcpTools: ContextStatsItem[]
  readonly agents: ContextStatsItem[]
  readonly skills: { tokens: number; items: ContextStatsItem[] } | null
  /** Last API response usage if available (for showing actual cached/fresh tokens). */
  readonly apiUsage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null
}

export type CompactSessionResult =
  | { ok: true; preTokens: number; postTokens: number }
  | { ok: false; error: string }

export interface McpServerInfo {
  name: string
  status: string
  toolCount: number
}
