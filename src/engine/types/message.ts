/**
 * Message types for the engine — reconstructed from claude-code's build-time generated types.
 * These mirror the exact shapes used by query.ts, utils/messages.ts, and the tool execution pipeline.
 */

import type { UUID } from 'crypto'
import type {
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { APIError } from '@anthropic-ai/sdk'
import type { PermissionMode } from './permissions.js'

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

export type PartialCompactDirection = 'forward' | 'backward'

export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'channel'; server: string }
  | { kind: 'coordinator' }
  | { kind: 'cron' }

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
  permissionMode?: PermissionMode
  origin?: MessageOrigin
}

// ============================================================================
// Assistant Message
// ============================================================================

export interface SDKAssistantMessageError {
  type: string
  message: string
}

export interface AssistantMessage extends BaseMessage {
  type: 'assistant'
  message: BetaMessage
  requestId?: string
  apiError?: APIError
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  isVirtual?: true
}

// Normalized versions for API consumption
export interface NormalizedUserMessage {
  role: 'user'
  content: ContentBlockParam[]
}

export interface NormalizedAssistantMessage {
  role: 'assistant'
  content: BetaContentBlock[]
}

export type NormalizedMessage = NormalizedUserMessage | NormalizedAssistantMessage

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

export interface Attachment {
  type: string
  content: string
  [key: string]: unknown
}

export interface AttachmentMessage extends BaseMessage {
  type: 'attachment'
  attachment: Attachment
}

// ============================================================================
// System Messages
// ============================================================================

export type SystemMessageLevel = 'info' | 'warning' | 'error'

interface SystemMessageBase extends BaseMessage {
  type: 'system'
  isMeta: boolean
}

export interface StopHookInfo {
  hookName: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
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
  error: string
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

export interface SystemCompactBoundaryMessage extends SystemMessageBase {
  subtype: 'compact_boundary'
  content: string
  level: SystemMessageLevel
  compactMetadata: {
    trigger: 'manual' | 'auto'
    preTokens: number
    userContext?: string
    messagesSummarized?: number
  }
  logicalParentUuid?: UUID
}

export interface SystemMicrocompactBoundaryMessage extends SystemMessageBase {
  subtype: 'microcompact_boundary'
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
}

// ============================================================================
// Grouped Tool Use (for UI rendering)
// ============================================================================

export interface GroupedToolUseMessage {
  type: 'grouped_tool_use'
  messages: AssistantMessage[]
}

export interface CollapsedReadSearchGroup {
  type: 'collapsed_read_search_group'
  messages: AssistantMessage[]
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
  | QueueOperationMessage

export type RenderableMessage =
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup

// ============================================================================
// Stream Events
// ============================================================================

export interface StreamEvent {
  type: 'stream_request_start'
}

export interface RequestStartEvent {
  type: 'request_start'
}
