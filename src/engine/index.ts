/**
 * Klaus Engine — agent engine adapted from claude-code.
 * Main entry point for the engine module.
 */

// Core query loop
export { query, type QueryParams, type Terminal } from './query.js'

// Tool types and utilities
export {
  type Tool,
  type Tools,
  type ToolDef,
  type ToolUseContext,
  type ToolResult,
  type ToolCallProgress,
  type ToolInputJSONSchema,
  type CanUseToolFn,
  type ToolPermissionContext,
  type ThinkingConfig,
  type ValidationResult,
  type AppState,
  type MCPServerConnection,
  type AgentDefinition,
  type AgentDefinitionsResult,
  buildTool,
  findToolByName,
  toolMatchesName,
  getEmptyToolPermissionContext,
} from './Tool.js'

// Message types
export type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  AttachmentMessage,
  ProgressMessage,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
  SystemCompactBoundaryMessage,
  MessageOrigin,
} from './types/message.js'

// Permission types
export type {
  PermissionMode,
  PermissionResult,
  PermissionBehavior,
  PermissionRule,
  PermissionDecision,
} from './types/permissions.js'

// API
export {
  queryModelWithStreaming,
  normalizeMessagesForAPI,
  buildToolSchemas,
} from './services/api/claude.js'
export { createAnthropicClient } from './services/api/client.js'

// Compaction
export {
  autoCompactIfNeeded,
  shouldAutoCompact,
  getAutoCompactThreshold,
} from './services/compact/autoCompact.js'
export {
  compactConversation,
  buildPostCompactMessages,
  type CompactionResult,
} from './services/compact/compact.js'

// Tool execution
export { runTools } from './services/tools/toolOrchestration.js'
export { runToolUse } from './services/tools/toolExecution.js'

// Utilities
export { tokenCountWithEstimation, tokenCountFromLastAPIResponse } from './utils/tokens.js'
export { getContextWindowForModel, getModelMaxOutputTokens } from './utils/context.js'
export type { SystemPrompt } from './utils/systemPromptType.js'
export type { QuerySource } from './constants/querySource.js'
export type { SessionId, AgentId } from './types/ids.js'
