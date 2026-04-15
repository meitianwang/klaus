/**
 * Engine entry point for Klaus — exports the core query engine, tools,
 * system prompt, and supporting infrastructure.
 *
 * Built with: bun run build-engine.ts
 * Output: dist/engine.js (single ESM bundle)
 */

// === Core Query Loop ===
export { query, type QueryParams } from '../query.js'
export type { Terminal } from '../query.js'

// === Tool System ===
export {
  type Tool,
  type Tools,
  type ToolDef,
  type ToolUseContext,
  type ToolResult,
  type ToolCallProgress,
  type ToolInputJSONSchema,
  type ToolPermissionContext,
  type ValidationResult,
  type SetToolJSXFn,
  type ContentReplacementState,
  type QueryChainTracking,
  type ToolProgress,
  type AnyObject,
  buildTool,
  findToolByName,
  toolMatchesName,
  getEmptyToolPermissionContext,
  filterToolProgressMessages,
} from '../Tool.js'

// === Tool Registry ===
export { getAllBaseTools } from '../tools.js'

// === Message Types ===
export type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  AttachmentMessage,
  ProgressMessage,
  StreamEvent,
  RequestStartEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
  SystemCompactBoundaryMessage,
  MessageOrigin,
} from '../types/message.js'

// === Permission Types ===
export type {
  PermissionMode,
  PermissionResult,
  PermissionBehavior,
  PermissionRule,
  PermissionDecision,
} from '../types/permissions.js'

// === CanUseToolFn ===
export type { CanUseToolFn } from '../hooks/useCanUseTool.js'

// === System Prompts ===
export { getSystemPrompt, computeEnvInfo, computeSimpleEnvInfo, getScratchpadInstructions, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, DEFAULT_AGENT_PROMPT } from '../constants/prompts.js'
export { clearSystemPromptSections, systemPromptSection, resolveSystemPromptSections } from '../constants/systemPromptSections.js'

// === API Client ===
export { queryModelWithStreaming } from '../services/api/claude.js'
export { getAnthropicClient } from '../services/api/client.js'

// === Messages ===
export {
  normalizeMessagesForAPI,
  createUserMessage,
  createSystemMessage,
  createAssistantAPIErrorMessage,
  createUserInterruptionMessage,
  createToolUseSummaryMessage,
  createMicrocompactBoundaryMessage,
  stripSignatureBlocks,
  getMessagesAfterCompactBoundary,
} from '../utils/messages.js'
export { asSystemPrompt, type SystemPrompt } from '../utils/systemPromptType.js'

// === Compaction ===
export {
  autoCompactIfNeeded,
  shouldAutoCompact,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
  calculateTokenWarningState,
  type AutoCompactTrackingState,
} from '../services/compact/autoCompact.js'
export {
  compactConversation,
  buildPostCompactMessages,
  type CompactionResult,
} from '../services/compact/compact.js'
export { microcompactMessages } from '../services/compact/microCompact.js'

// === Tool Execution ===
export { runTools } from '../services/tools/toolOrchestration.js'
export { runToolUse } from '../services/tools/toolExecution.js'
export { StreamingToolExecutor } from '../services/tools/StreamingToolExecutor.js'

// === Context Collapse ===
export {
  type ContextCollapseState,
  type ContextCollapseStats,
} from '../services/contextCollapse/index.js'

// === Tool Result Storage ===
export {
  createContentReplacementState,
  applyToolResultBudget,
  reconstructContentReplacementState,
} from '../utils/toolResultStorage.js'

// === Tokens ===
export {
  tokenCountWithEstimation,
  tokenCountFromLastAPIResponse,
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
} from '../utils/tokens.js'
export { getContextWindowForModel, getModelMaxOutputTokens, ESCALATED_MAX_TOKENS } from '../utils/context.js'

// === Bootstrap State ===
export {
  getSessionId,
  regenerateSessionId,
  getOriginalCwd,
  getProjectRoot,
  getIsNonInteractiveSession,
} from '../bootstrap/state.js'

// === Analytics ===
export {
  logEvent,
  logEventAsync,
  attachAnalyticsSink,
  type AnalyticsSink,
} from '../services/analytics/index.js'

// === Config ===
export {
  getGlobalConfig,
  saveGlobalConfig,
} from '../utils/config.js'

// === MCP Types ===
export type {
  MCPServerConnection,
  ConnectedMCPServer,
  ServerResource,
  McpServerConfig,
  SerializedClient,
  SerializedTool,
} from '../services/mcp/types.js'

// === Session Storage ===
export {
  recordContentReplacement,
} from '../utils/sessionStorage.js'

// === IDs ===
export type { SessionId, AgentId } from '../types/ids.js'
export type { QuerySource } from '../constants/querySource.js'

// === Thinking Config ===
export type { ThinkingConfig } from '../utils/thinking.js'

// === AppState ===
export { type AppState, type AppStateStore, getDefaultAppState } from '../state/AppStateStore.js'

// === Cost Tracking ===
export { formatTotalCost } from '../cost-tracker.js'

// === Hooks ===
export { executePostSamplingHooks } from '../utils/hooks/postSamplingHooks.js'
export { executeStopFailureHooks } from '../utils/hooks.js'

// === Query Dependencies (for custom DI) ===
export type { QueryDeps } from '../query/deps.js'

// === Errors ===
export { PROMPT_TOO_LONG_ERROR_MESSAGE, isPromptTooLongMessage } from '../services/api/errors.js'

// === Model Utils ===
export { getRuntimeMainLoopModel, renderModelName, getCanonicalName, getMarketingNameForModel } from '../utils/model/model.js'

// === Feature Gates ===
export { feature } from 'bun:bundle'
