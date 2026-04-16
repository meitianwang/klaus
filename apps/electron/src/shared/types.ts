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

export interface CronTask {
  id: string
  name?: string
  description?: string
  schedule: string
  prompt: string
  enabled: boolean
  thinking?: string
  timeoutSeconds?: number
  createdAt: number
  updatedAt: number
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
  | { type: 'message_complete'; sessionId: string }
  | { type: 'context_collapse_stats'; sessionId: string; collapsedSpans: number; stagedSpans: number }
  | { type: 'api_error'; sessionId: string; error: string }
  | { type: 'api_retry'; sessionId: string; attempt: number; maxRetries: number; delayMs: number }
  | { type: 'done'; sessionId: string }

export interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: unknown
  message: string
  suggestions?: PermissionSuggestion[]
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
