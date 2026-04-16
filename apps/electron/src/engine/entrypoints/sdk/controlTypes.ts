// Stub: SDK Control Types for external builds.
// Type definitions derived from the Zod schemas in controlSchemas.ts.

import type {
  SDKMessage,
  PermissionMode,
  PermissionUpdate,
} from './coreTypes.js'

// ============================================================================
// Control Request Types
// ============================================================================

export type SDKControlPermissionRequest = {
  subtype: 'can_use_tool'
  tool_name: string
  input: Record<string, unknown>
  permission_suggestions?: PermissionUpdate[]
  blocked_path?: string
  decision_reason?: string
  title?: string
  display_name?: string
  tool_use_id: string
  agent_id?: string
  description?: string
}

export type SDKControlRequestInner =
  | { subtype: 'interrupt' }
  | SDKControlPermissionRequest
  | { subtype: 'initialize'; [key: string]: unknown }
  | { subtype: 'set_permission_mode'; mode: PermissionMode; ultraplan?: boolean }
  | { subtype: 'set_model'; model?: string }
  | { subtype: 'set_max_thinking_tokens'; max_thinking_tokens: number | null }
  | { subtype: 'mcp_status' }
  | { subtype: 'get_context_usage' }
  | { subtype: 'hook_callback'; callback_id: string; input: unknown; tool_use_id?: string }
  | { subtype: 'mcp_message'; server_name: string; message: unknown }
  | { subtype: 'rewind_files'; user_message_id: string; dry_run?: boolean }
  | { subtype: 'cancel_async_message'; message_uuid: string }
  | { subtype: 'seed_read_state'; path: string; mtime: number }
  | { subtype: 'mcp_set_servers'; servers: Record<string, unknown> }
  | { subtype: 'reload_plugins' }
  | { subtype: 'mcp_reconnect'; serverName: string }
  | { subtype: 'mcp_toggle'; serverName: string; enabled: boolean }
  | { subtype: 'stop_task'; task_id: string }
  | { subtype: 'apply_flag_settings'; settings: Record<string, unknown> }
  | { subtype: 'get_settings' }
  | { subtype: 'elicitation'; mcp_server_name: string; message: string; [key: string]: unknown }

export type SDKControlRequest = {
  type: 'control_request'
  request_id: string
  request: SDKControlRequestInner
}

export type SDKControlResponse = {
  type: 'control_response'
  response:
    | {
        subtype: 'success'
        request_id: string
        response?: Record<string, unknown>
      }
    | {
        subtype: 'error'
        request_id: string
        error: string
        pending_permission_requests?: SDKControlRequest[]
      }
}

export type SDKControlCancelRequest = {
  type: 'control_cancel_request'
  request_id: string
}

// ============================================================================
// Aggregate Message Types
// ============================================================================

export type StdoutMessage =
  | SDKMessage
  | SDKControlResponse
  | SDKControlRequest
  | SDKControlCancelRequest
  | { type: 'keep_alive' }
  | { type: 'streamlined_text'; text: string; session_id: string; uuid: string }
  | { type: 'streamlined_tool_use_summary'; tool_summary: string; session_id: string; uuid: string }
  | { type: 'system'; subtype: 'post_turn_summary'; [key: string]: unknown }
