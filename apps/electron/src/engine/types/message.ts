/**
 * Message types for the engine — reconstructed from claude-code's build-time generated types.
 * These mirror the exact shapes used by query.ts, utils/messages.ts, and the tool execution pipeline.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- shadows crypto.UUID with relaxed alias
type UUID = string
import type {
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { PermissionMode } from './permissions.js'
import type {
  BranchAction,
  CommitKind,
  PrAction,
} from '../tools/shared/gitOperationTracking.js'

// Re-export Usage for convenience
export type { Usage }

// ============================================================================
// Base message fields
// ============================================================================

interface BaseMessage {
  uuid: UUID
  timestamp: string
}

// ============================================================================
// User Message
// ============================================================================

export type PartialCompactDirection = 'forward' | 'backward' | 'from' | 'up_to'

export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'channel'; server: string }
  | { kind: 'coordinator' }
  | { kind: 'cron' }
  | { kind: 'task-notification' }

export interface UserMessage extends BaseMessage {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  sourceToolUseID?: string
  permissionMode?: PermissionMode
  origin?: MessageOrigin
  planContent?: unknown
}

// ============================================================================
// Assistant Message
// ============================================================================

export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'
  | 'overloaded'

export interface AssistantMessage extends BaseMessage {
  type: 'assistant'
  message: BetaMessage
  requestId?: string
  apiError?: string
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  isVirtual?: true
  isMeta?: true
  advisorModel?: string
  research?: unknown
}

// Normalized versions — these carry full message fields plus array-only content.
// normalizeMessages() preserves all original fields but ensures content is always an array.
export interface NormalizedUserMessage extends BaseMessage {
  type: 'user'
  message: {
    role: 'user'
    content: ContentBlockParam[]
  }
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: UserMessage['summarizeMetadata']
  toolUseResult?: unknown
  mcpMeta?: UserMessage['mcpMeta']
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  sourceToolUseID?: string
  permissionMode?: PermissionMode
  origin?: MessageOrigin
}

export interface NormalizedAssistantMessage<
  C extends BetaContentBlock = BetaContentBlock,
> extends BaseMessage {
  type: 'assistant'
  message: Omit<BetaMessage, 'content'> & { content: C[] }
  requestId?: string
  apiError?: string
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  isVirtual?: true
  isMeta?: true
  advisorModel?: string
  research?: unknown
  // The following fields exist on NormalizedUserMessage but may appear here
  // when code uses NormalizedMessage union without proper narrowing.
  isVisibleInTranscriptOnly?: true
  isCompactSummary?: true
  mcpMeta?: UserMessage['mcpMeta']
  toolUseResult?: unknown
}

// NormalizedMessage is the full union used after normalizeMessages().
// normalizeMessages() passes through progress, attachment, and system messages unchanged,
// so consumers of NormalizedMessage[] need to handle all these types.
export type NormalizedMessage =
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | ProgressMessage
  | AttachmentMessage
  | SystemMessage

// ============================================================================
// Progress Message
// ============================================================================

export interface ProgressMessage<P = unknown> extends BaseMessage {
  type: 'progress'
  data: P
  toolUseID: string
  parentToolUseID: string
}

// ============================================================================
// Attachment Message
// ============================================================================

// Re-export the full Attachment union from attachments.ts
export type { Attachment } from '../utils/attachments.js'

export interface AttachmentMessage<
  A extends import('../utils/attachments.js').Attachment = import('../utils/attachments.js').Attachment,
> extends BaseMessage {
  type: 'attachment'
  attachment: A
}

// ============================================================================
// System Messages
// ============================================================================

export type SystemMessageLevel = 'info' | 'warning' | 'error' | 'suggestion'

interface SystemMessageBase extends BaseMessage {
  type: 'system'
  isMeta?: boolean
}

export interface StopHookInfo {
  command: string
  promptText?: string
  durationMs?: number
}

export interface SystemInformationalMessage extends SystemMessageBase {
  subtype: 'informational'
  content: string
  level: SystemMessageLevel
  toolUseID?: string
  preventContinuation?: boolean
}

export interface SystemAPIErrorMessage extends SystemMessageBase {
  subtype: 'api_error'
  error: string | import('@anthropic-ai/sdk').APIError
  level?: SystemMessageLevel
  cause?: Error
  retryInMs: number
  retryAttempt: number
  maxRetries: number
}

export interface SystemBridgeStatusMessage extends SystemMessageBase {
  subtype: 'bridge_status'
  content: string
  url: string
  upgradeNudge?: string
}

export interface SystemMemorySavedMessage extends SystemMessageBase {
  subtype: 'memory_saved'
  writtenPaths: string[]
  teamCount?: number
  verb?: string
}

export interface SystemStopHookSummaryMessage extends SystemMessageBase {
  subtype: 'stop_hook_summary'
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  preventedContinuation: boolean
  stopReason: string | undefined
  hasOutput: boolean
  level: SystemMessageLevel
  toolUseID?: string
  hookLabel?: string
  totalDurationMs?: number
}

export interface SystemTurnDurationMessage extends SystemMessageBase {
  subtype: 'turn_duration'
  durationMs: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
}

export interface SystemLocalCommandMessage extends SystemMessageBase {
  subtype: 'local_command'
  content: string
  level: SystemMessageLevel
}

export interface CompactMetadata {
  trigger: 'manual' | 'auto'
  preTokens: number
  userContext?: string
  messagesSummarized?: number
  preCompactDiscoveredTools?: string[]
  preservedSegment?: {
    headUuid?: UUID
    anchorUuid?: UUID
    tailUuid: UUID
    [key: string]: unknown
  }
}

export interface SystemCompactBoundaryMessage extends SystemMessageBase {
  subtype: 'compact_boundary'
  content: string
  level: SystemMessageLevel
  compactMetadata: CompactMetadata
  logicalParentUuid?: UUID
}

export interface SystemMicrocompactBoundaryMessage extends SystemMessageBase {
  subtype: 'microcompact_boundary'
  content?: string
  level?: SystemMessageLevel
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export interface SystemPermissionRetryMessage extends SystemMessageBase {
  subtype: 'permission_retry'
  content: string
  commands: string[]
  level: SystemMessageLevel
}

export interface SystemScheduledTaskFireMessage extends SystemMessageBase {
  subtype: 'scheduled_task_fire'
  content: string
}

export interface SystemAwaySummaryMessage extends SystemMessageBase {
  subtype: 'away_summary'
  content: string
}

export interface SystemAgentsKilledMessage extends SystemMessageBase {
  subtype: 'agents_killed'
}

export interface SystemApiMetricsMessage extends SystemMessageBase {
  subtype: 'api_metrics'
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}

export interface SystemThinkingMessage extends SystemMessageBase {
  subtype: 'thinking'
  content: string
}

export interface SystemFileSnapshotMessage extends SystemMessageBase {
  subtype: 'file_snapshot'
  content: string
  level: SystemMessageLevel
  snapshotFiles: Array<{
    key: string
    path: string
    content: string
  }>
}

export type SystemMessage =
  | SystemInformationalMessage
  | SystemAPIErrorMessage
  | SystemBridgeStatusMessage
  | SystemMemorySavedMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemLocalCommandMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemPermissionRetryMessage
  | SystemScheduledTaskFireMessage
  | SystemAwaySummaryMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemThinkingMessage
  | SystemFileSnapshotMessage

// ============================================================================
// Tombstone & Summary Messages
// ============================================================================

export interface TombstoneMessage {
  type: 'tombstone'
  message: Message
}

export interface ToolUseSummaryMessage extends BaseMessage {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
}

// ============================================================================
// Hook Result Message
// ============================================================================

export interface HookResultMessage extends BaseMessage {
  type: 'hook_result'
  hookName: string
  content: string
  toolUseID?: string
  data?: unknown
  attachment?: import('../utils/attachments.js').Attachment
}

// ============================================================================
// Grouped Tool Use (for UI rendering)
// ============================================================================

export interface GroupedToolUseMessage {
  type: 'grouped_tool_use'
  messages: AssistantMessage[]
  toolName?: string
  displayMessage?: RenderableMessage
  input?: unknown
  results?: unknown[]
  uuid?: UUID
  timestamp?: string | number
}

export interface CollapsedReadSearchGroup {
  type: 'collapsed_read_search' | 'collapsed_read_search_group'
  messages: AssistantMessage[]
  displayMessage?: RenderableMessage
  uuid?: UUID
  timestamp?: number
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount: number
  memoryReadCount: number
  memoryWriteCount: number
  readFilePaths: string[]
  searchArgs: string[]
  latestDisplayHint?: string
  teamMemorySearchCount?: number
  teamMemoryReadCount?: number
  teamMemoryWriteCount?: number
  mcpCallCount?: number
  mcpServerNames?: string[]
  bashCount?: number
  gitOpBashCount?: number
  commits?: { sha: string; kind: CommitKind }[]
  pushes?: { branch: string }[]
  branches?: { ref: string; action: BranchAction }[]
  prs?: { number: number; url?: string; action: PrAction }[]
  hookTotalMs?: number
  hookCount?: number
  hookInfos?: StopHookInfo[]
  relevantMemories?: { path: string; content: string; mtimeMs: number }[]
}

// ============================================================================
// Queue Operation Message
// ============================================================================

export interface QueueOperationMessage extends BaseMessage {
  type: 'queue_operation'
  operation: string
  [key: string]: unknown
}

// ============================================================================
// Union Types
// ============================================================================

export type Message =
  | UserMessage
  | AssistantMessage
  | ProgressMessage
  | AttachmentMessage
  | SystemMessage
  | HookResultMessage

/** Extended message type including hook results for contexts that handle all message types. */
export type AnyMessage = Message | HookResultMessage

export type RenderableMessage =
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup
  | QueueOperationMessage

// ============================================================================
// Stream Events
// ============================================================================

export interface StreamEvent {
  type: 'stream_event'
  event: BetaRawMessageStreamEvent
  ttftMs?: number
}

export interface RequestStartEvent {
  type: 'stream_request_start'
}
