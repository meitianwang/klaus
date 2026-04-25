// IPC message types shared between main and renderer

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
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
  | { type: 'tool_end'; sessionId: string; toolName: string; toolCallId: string; isError: boolean }
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
  | { type: 'interrupted'; sessionId: string }
  | { type: 'requesting'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  | { type: 'compact_boundary'; sessionId: string }
  | { type: 'tombstone'; sessionId: string; messageUuid: string }
  | { type: 'file'; sessionId: string; name?: string; url?: string }
  | { type: 'team_created'; sessionId: string; teamName: string }
  | { type: 'mcp_auth_url'; sessionId: string; url?: string; serverName?: string }
  | { type: 'permission_cancelled'; sessionId: string; requestId: string }
  | { type: 'done'; sessionId: string }

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

export interface McpServerInfo {
  name: string
  status: string
  toolCount: number
}
