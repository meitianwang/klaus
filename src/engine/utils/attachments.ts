/**
 * Simplified attachments module for Klaus — adapted from claude-code's utils/attachments.ts.
 * Removes analytics, feature flags, skill search, hook attachments, IDE integration,
 * file reading logic, and most complex attachment types.
 * Keeps: core Attachment types, memoryHeader, and essential config constants.
 */

import type {
  ContentBlockParam,
  ImageBlockParam,
  Base64ImageSource,
} from '@anthropic-ai/sdk/resources/messages.mjs'

// ============================================================================
// Config constants
// ============================================================================

export const TODO_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
} as const

export const PLAN_MODE_ATTACHMENT_CONFIG = {
  TURNS_BETWEEN_ATTACHMENTS: 5,
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5,
} as const

export const AUTO_MODE_ATTACHMENT_CONFIG = {
  TURNS_BETWEEN_ATTACHMENTS: 5,
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5,
} as const

export const RELEVANT_MEMORIES_CONFIG = {
  MAX_SESSION_BYTES: 60 * 1024,
} as const

export const VERIFY_PLAN_REMINDER_CONFIG = {
  TURNS_BETWEEN_REMINDERS: 10,
} as const

// ============================================================================
// Attachment types
// ============================================================================

export type FileAttachment = {
  type: 'file'
  filename: string
  content: string
  truncated?: boolean
  displayPath: string
}

export type CompactFileReferenceAttachment = {
  type: 'compact_file_reference'
  filename: string
  displayPath: string
}

export type PDFReferenceAttachment = {
  type: 'pdf_reference'
  filename: string
  pageCount: number
  fileSize: number
  displayPath: string
}

export type AlreadyReadFileAttachment = {
  type: 'already_read_file'
  filename: string
  content: string
  truncated?: boolean
  displayPath: string
}

export type AgentMentionAttachment = {
  type: 'agent_mention'
  agentType: string
}

export type HookPermissionDecisionAttachment = {
  type: 'hook_permission_decision'
  decision: 'allow' | 'deny'
  toolUseID: string
  hookEvent: string
}

export type HookAttachment =
  | HookPermissionDecisionAttachment
  | {
      type: 'hook_cancelled' | 'hook_blocking_error' | 'hook_stopped_continuation' |
            'hook_non_blocking_error' | 'hook_error_during_execution' |
            'hook_success' | 'hook_additional_context' | 'hook_system_message'
      [key: string]: unknown
    }

export type Attachment =
  | FileAttachment
  | CompactFileReferenceAttachment
  | PDFReferenceAttachment
  | AlreadyReadFileAttachment
  | AgentMentionAttachment
  | HookAttachment
  | {
      type: 'edited_text_file'
      filename: string
      [key: string]: unknown
    }
  | {
      type: 'memory'
      content: string
      path: string
      [key: string]: unknown
    }
  | {
      type: 'todo_reminder'
      content: string
      [key: string]: unknown
    }
  | {
      type: 'plan_mode'
      content: string
      [key: string]: unknown
    }
  | {
      type: 'relevant_memory'
      content: string
      path: string
      [key: string]: unknown
    }
  | {
      type: string
      content?: string
      [key: string]: unknown
    }

// ============================================================================
// Memory header
// ============================================================================

/**
 * Compute human-readable age string from a mtime timestamp.
 */
function memoryAge(mtimeMs: number): string {
  const ageMs = Date.now() - mtimeMs
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

/**
 * Check if memory is stale (>30 days).
 */
function memoryFreshnessText(mtimeMs: number): string | null {
  const ageMs = Date.now() - mtimeMs
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
  if (days > 30) {
    return `⚠️ This memory was saved ${days} days ago and may be outdated.`
  }
  return null
}

/**
 * Generate a header string for a memory file being injected into context.
 */
export function memoryHeader(path: string, mtimeMs: number): string {
  const staleness = memoryFreshnessText(mtimeMs)
  return staleness
    ? `${staleness}\n\nMemory: ${path}:`
    : `Memory (saved ${memoryAge(mtimeMs)}): ${path}:`
}
