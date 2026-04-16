// Stub: SDK Core Types for external builds.
// Type definitions derived from the Zod schemas in coreSchemas.ts.

import type {
  MessageParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/index.mjs'

// Re-export sandbox types
export type {
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
} from '../sandboxTypes.js'

// Re-export utility types
export type { NonNullableUsage } from './sdkUtilityTypes.js'

// ============================================================================
// Const arrays for runtime usage
// ============================================================================

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

export const EXIT_REASONS = [
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const

// ============================================================================
// Usage & Model Types
// ============================================================================

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

// ============================================================================
// Output Format Types
// ============================================================================

export type OutputFormatType = 'json_schema'

export type JsonSchemaOutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>
}

export type OutputFormat = JsonSchemaOutputFormat

// ============================================================================
// Config Types
// ============================================================================

export type ApiKeySource = 'user' | 'project' | 'org' | 'temporary' | 'oauth'

export type ConfigScope = 'local' | 'user' | 'project'

// ============================================================================
// MCP Server Config Types
// ============================================================================

export type McpStdioServerConfig = {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpSSEServerConfig = {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export type McpHttpServerConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpSdkServerConfig = {
  type: 'sdk'
  name: string
}

export type McpServerConfigForProcessTransport =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig

export type McpClaudeAIProxyServerConfig = {
  type: 'claudeai-proxy'
  url: string
  id: string
}

export type McpServerStatusConfig =
  | McpServerConfigForProcessTransport
  | McpClaudeAIProxyServerConfig

export type McpServerStatus = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  serverInfo?: { name: string; version: string }
  error?: string
  config?: McpServerStatusConfig
  scope?: string
  tools?: Array<{
    name: string
    description?: string
    annotations?: {
      readOnly?: boolean
      destructive?: boolean
      openWorld?: boolean
    }
  }>
  capabilities?: {
    experimental?: Record<string, unknown>
  }
}

// ============================================================================
// Permission Types
// ============================================================================

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionUpdate =
  | {
      type: 'addRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'replaceRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'removeRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'setMode'
      mode: PermissionMode
      destination: PermissionUpdateDestination
    }
  | {
      type: 'addDirectories'
      directories: string[]
      destination: PermissionUpdateDestination
    }
  | {
      type: 'removeDirectories'
      directories: string[]
      destination: PermissionUpdateDestination
    }

export type PermissionDecisionClassification =
  | 'user_temporary'
  | 'user_permanent'
  | 'user_reject'

export type PermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
      toolUseID?: string
      decisionClassification?: PermissionDecisionClassification
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
      decisionClassification?: PermissionDecisionClassification
    }

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'

// ============================================================================
// Hook Types
// ============================================================================

export type HookEvent = (typeof HOOK_EVENTS)[number]

type BaseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
}

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: unknown
  permission_suggestions?: PermissionUpdate[]
}

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}

export type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  error: string
  is_interrupt?: boolean
}

export type PermissionDeniedHookInput = BaseHookInput & {
  hook_event_name: 'PermissionDenied'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  reason: string
}

export type NotificationHookInput = BaseHookInput & {
  hook_event_name: 'Notification'
  message: string
  title?: string
  notification_type: string
}

export type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart'
  source: 'startup' | 'resume' | 'clear' | 'compact'
  agent_type?: string
  model?: string
}

export type SetupHookInput = BaseHookInput & {
  hook_event_name: 'Setup'
  trigger: 'init' | 'maintenance'
}

export type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message?: string
}

export type StopFailureHookInput = BaseHookInput & {
  hook_event_name: 'StopFailure'
  error: SDKAssistantMessageError
  error_details?: string
  last_assistant_message?: string
}

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart'
  agent_id: string
  agent_type: string
}

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop'
  stop_hook_active: boolean
  agent_id: string
  agent_transcript_path: string
  agent_type: string
  last_assistant_message?: string
}

export type PreCompactHookInput = BaseHookInput & {
  hook_event_name: 'PreCompact'
  trigger: 'manual' | 'auto'
  custom_instructions: string | null
}

export type PostCompactHookInput = BaseHookInput & {
  hook_event_name: 'PostCompact'
  trigger: 'manual' | 'auto'
  compact_summary: string
}

export type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: 'TeammateIdle'
  teammate_name: string
  team_name: string
}

export type TaskCreatedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCreated'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCompleted'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export type ElicitationHookInput = BaseHookInput & {
  hook_event_name: 'Elicitation'
  mcp_server_name: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}

export type ElicitationResultHookInput = BaseHookInput & {
  hook_event_name: 'ElicitationResult'
  mcp_server_name: string
  elicitation_id?: string
  mode?: 'form' | 'url'
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: 'ConfigChange'
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills'
  file_path?: string
}

export type InstructionsLoadedHookInput = BaseHookInput & {
  hook_event_name: 'InstructionsLoaded'
  file_path: string
  memory_type: 'User' | 'Project' | 'Local' | 'Managed'
  load_reason:
    | 'session_start'
    | 'nested_traversal'
    | 'path_glob_match'
    | 'include'
    | 'compact'
  globs?: string[]
  trigger_file_path?: string
  parent_file_path?: string
}

export type CwdChangedHookInput = BaseHookInput & {
  hook_event_name: 'CwdChanged'
  old_cwd: string
  new_cwd: string
}

export type FileChangedHookInput = BaseHookInput & {
  hook_event_name: 'FileChanged'
  file_path: string
  event: 'change' | 'add' | 'unlink'
}

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd'
  reason: ExitReason
}

export type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeCreate'
  name: string
}

export type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeRemove'
  worktree_path: string
}

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PermissionDeniedHookInput
  | NotificationHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | StopFailureHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PostCompactHookInput
  | PermissionRequestHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCreatedHookInput
  | TaskCompletedHookInput
  | ElicitationHookInput
  | ElicitationResultHookInput
  | ConfigChangeHookInput
  | InstructionsLoadedHookInput
  | CwdChangedHookInput
  | FileChangedHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput

export type ExitReason = (typeof EXIT_REASONS)[number]

// ============================================================================
// Hook Output Types
// ============================================================================

export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}

export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?:
    | {
        hookEventName: 'PreToolUse'
        permissionDecision?: PermissionBehavior
        permissionDecisionReason?: string
        updatedInput?: Record<string, unknown>
        additionalContext?: string
      }
    | { hookEventName: 'UserPromptSubmit'; additionalContext?: string }
    | {
        hookEventName: 'SessionStart'
        additionalContext?: string
        initialUserMessage?: string
        watchPaths?: string[]
      }
    | { hookEventName: 'Setup'; additionalContext?: string }
    | { hookEventName: 'SubagentStart'; additionalContext?: string }
    | {
        hookEventName: 'PostToolUse'
        additionalContext?: string
        updatedMCPToolOutput?: unknown
      }
    | { hookEventName: 'PostToolUseFailure'; additionalContext?: string }
    | { hookEventName: 'PermissionDenied'; retry?: boolean }
    | { hookEventName: 'Notification'; additionalContext?: string }
    | {
        hookEventName: 'PermissionRequest'
        decision:
          | {
              behavior: 'allow'
              updatedInput?: Record<string, unknown>
              updatedPermissions?: PermissionUpdate[]
            }
          | {
              behavior: 'deny'
              message?: string
              interrupt?: boolean
            }
      }
    | {
        hookEventName: 'Elicitation'
        action?: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }
    | {
        hookEventName: 'ElicitationResult'
        action?: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }
    | { hookEventName: 'CwdChanged'; watchPaths?: string[] }
    | { hookEventName: 'FileChanged'; watchPaths?: string[] }
    | { hookEventName: 'WorktreeCreate'; worktreePath: string }
}

export type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput

// ============================================================================
// Skill/Command Types
// ============================================================================

export type SlashCommand = {
  name: string
  description: string
  argumentHint: string
}

export type AgentInfo = {
  name: string
  description: string
  model?: string
}

export type ModelInfo = {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'max'>
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
}

export type AccountInfo = {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  apiProvider?: 'firstParty' | 'bedrock' | 'vertex' | 'foundry'
}

// ============================================================================
// Agent Definition Types
// ============================================================================

export type AgentMcpServerSpec =
  | string
  | Record<string, McpServerConfigForProcessTransport>

export type AgentDefinition = {
  description: string
  tools?: string[]
  disallowedTools?: string[]
  prompt: string
  model?: string
  mcpServers?: AgentMcpServerSpec[]
  criticalSystemReminder_EXPERIMENTAL?: string
  skills?: string[]
  initialPrompt?: string
  maxTurns?: number
  background?: boolean
  memory?: 'user' | 'project' | 'local'
  effort?: 'low' | 'medium' | 'high' | 'max' | number
  permissionMode?: PermissionMode
}

// ============================================================================
// Settings Types
// ============================================================================

export type SettingSource = 'user' | 'project' | 'local'

export type SdkPluginConfig = {
  type: 'local'
  path: string
}

// ============================================================================
// Rewind Types
// ============================================================================

export type RewindFilesResult = {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

// ============================================================================
// SDK Message Types
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

export type SDKStatus = 'compacting' | null

export type SDKUserMessage = {
  type: 'user'
  message: unknown
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKUserMessageReplay = {
  type: 'user'
  message: unknown
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid: string
  session_id: string
  isReplay: true
}

export type SDKRateLimitInfo = {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
    | 'overage'
  utilization?: number
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected'
  overageResetsAt?: number
  overageDisabledReason?:
    | 'overage_not_provisioned'
    | 'org_level_disabled'
    | 'org_level_disabled_until'
    | 'out_of_credits'
    | 'seat_tier_level_disabled'
    | 'member_level_disabled'
    | 'seat_tier_zero_credit_limit'
    | 'group_zero_credit_limit'
    | 'member_zero_credit_limit'
    | 'org_service_level_disabled'
    | 'org_service_zero_credit_limit'
    | 'no_limits_configured'
    | 'unknown'
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

export type SDKAssistantMessage = {
  type: 'assistant'
  message: unknown
  parent_tool_use_id: string | null
  error?: SDKAssistantMessageError
  uuid: string
  session_id: string
}

export type SDKPartialAssistantMessage = {
  type: 'stream_event'
  event: unknown
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export type SDKPermissionDenial = {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export type FastModeState = 'off' | 'cooldown' | 'on'

export type SDKResultSuccess = {
  type: 'result'
  subtype: 'success'
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result: string
  stop_reason: string | null
  total_cost_usd: number
  usage: unknown
  modelUsage: Record<string, ModelUsage>
  permission_denials: SDKPermissionDenial[]
  structured_output?: unknown
  fast_mode_state?: FastModeState
  uuid: string
  session_id: string
}

export type SDKResultError = {
  type: 'result'
  subtype:
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  stop_reason: string | null
  total_cost_usd: number
  usage: unknown
  modelUsage: Record<string, ModelUsage>
  permission_denials: SDKPermissionDenial[]
  errors: string[]
  fast_mode_state?: FastModeState
  uuid: string
  session_id: string
}

export type SDKResultMessage = SDKResultSuccess | SDKResultError

export type SDKSystemMessage = {
  type: 'system'
  subtype: 'init'
  agents?: string[]
  apiKeySource: ApiKeySource
  betas?: string[]
  claude_code_version: string
  cwd: string
  tools: string[]
  mcp_servers: Array<{ name: string; status: string }>
  model: string
  permissionMode: PermissionMode
  slash_commands: string[]
  output_style: string
  skills: string[]
  plugins: Array<{ name: string; path: string; source?: string }>
  fast_mode_state?: FastModeState
  uuid: string
  session_id: string
}

export type SDKCompactBoundaryMessage = {
  type: 'system'
  subtype: 'compact_boundary'
  compact_metadata: {
    trigger: 'manual' | 'auto'
    pre_tokens: number
    preserved_segment?: {
      head_uuid: string
      anchor_uuid: string
      tail_uuid: string
    }
  }
  uuid: string
  session_id: string
}

export type SDKStatusMessage = {
  type: 'system'
  subtype: 'status'
  status: SDKStatus
  permissionMode?: PermissionMode
  uuid: string
  session_id: string
}

export type SDKToolProgressMessage = {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds: number
  task_id?: string
  uuid: string
  session_id: string
}

export type SDKSessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  createdAt?: number
}

export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | { type: 'system'; subtype: 'api_retry'; [key: string]: unknown }
  | { type: 'system'; subtype: 'local_command_output'; [key: string]: unknown }
  | { type: 'system'; subtype: 'hook_started'; [key: string]: unknown }
  | { type: 'system'; subtype: 'hook_progress'; [key: string]: unknown }
  | { type: 'system'; subtype: 'hook_response'; [key: string]: unknown }
  | SDKToolProgressMessage
  | { type: 'auth_status'; [key: string]: unknown }
  | { type: 'system'; subtype: 'task_notification'; [key: string]: unknown }
  | { type: 'system'; subtype: 'task_started'; [key: string]: unknown }
  | { type: 'system'; subtype: 'task_progress'; [key: string]: unknown }
  | { type: 'system'; subtype: 'session_state_changed'; [key: string]: unknown }
  | { type: 'system'; subtype: 'files_persisted'; [key: string]: unknown }
  | { type: 'tool_use_summary'; [key: string]: unknown }
  | { type: 'rate_limit_event'; [key: string]: unknown }
  | { type: 'system'; subtype: 'elicitation_complete'; [key: string]: unknown }
  | { type: 'prompt_suggestion'; [key: string]: unknown }
  | { type: 'system'; subtype: 'post_turn_summary'; [key: string]: unknown }
