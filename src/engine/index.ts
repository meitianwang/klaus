/**
 * Engine public API — re-exports everything Klaus integration layer needs.
 * This file is NOT @ts-nocheck; it serves as the typed boundary.
 */

// Query loop
export { query } from "./query.js";
export type { QueryParams } from "./query.js";

// Message types
export type {
  Message,
  AssistantMessage,
  UserMessage,
  StreamEvent,
} from "./types/message.js";

// Tool types
export type {
  ToolUseContext,
  ToolPermissionContext,
  Tools,
  Tool,
} from "./Tool.js";
export {
  getEmptyToolPermissionContext,
  buildTool,
} from "./Tool.js";
export type { CanUseToolFn } from "./hooks/useCanUseTool.js";

// Thinking config
export type { ThinkingConfig } from "./utils/thinking.js";

// App state
export type { AppState } from "./state/AppState.js";

// System prompt utilities
export {
  systemPromptSection,
  DANGEROUS_uncachedSystemPromptSection,
  resolveSystemPromptSections,
  clearSystemPromptSections,
} from "./constants/systemPromptSections.js";
export { getSystemPrompt } from "./constants/prompts.js";
export { asSystemPrompt } from "./utils/systemPromptType.js";
export type { SystemPrompt } from "./utils/systemPromptType.js";

// Bootstrap state
export {
  getSessionId,
  getOriginalCwd,
  setOriginalCwd,
  setCwdState,
  setProjectRoot,
} from "./bootstrap/state.js";

// Tools
export { getAllBaseTools, assembleToolPool } from "./tools.js";

// Context collapse
export {
  initContextCollapse,
  resetContextCollapse,
  isContextCollapseEnabled,
  getStats as getContextCollapseStats,
} from "./services/contextCollapse/index.js";
export type {
  ContextCollapseStats,
  ContextCollapseHealth,
} from "./services/contextCollapse/index.js";

// Content replacement state
export { createContentReplacementState } from "./utils/toolResultStorage.js";
export type { ContentReplacementState } from "./utils/toolResultStorage.js";

// Analytics
export { attachAnalyticsSink } from "./services/analytics/index.js";
export type { AnalyticsSink } from "./services/analytics/index.js";

// Cost tracker — re-export with names Klaus expects
export {
  getTotalCost,
  getTotalDuration,
  getTotalAPIDuration,
  getModelUsage,
  getTotalInputTokens,
  getTotalOutputTokens,
} from "./cost-tracker.js";
export {
  getTotalCostUSD,
  getTotalToolDuration,
} from "./bootstrap/state.js";
export { formatTotalCost } from "./cost-tracker.js";
