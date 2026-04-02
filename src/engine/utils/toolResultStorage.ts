/**
 * Tool result storage — simplified from claude-code's toolResultStorage.ts.
 * Stripped: analytics, GrowthBook, bootstrap/state dependency.
 * Preserved: type definitions and core persistence functions.
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Message } from '../types/message.js'
import { toError } from './errors.js'
import { jsonStringify } from './slowOperations.js'
import { getProjectDir } from './sessionStorage.js'

// Subdirectory name for tool results within a session
export const TOOL_RESULTS_SUBDIR = 'tool-results'

// XML tags for persisted output messages
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

// Message used when tool result content was cleared without persisting
export const TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]'

// Default limits
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000
export const MAX_TOOL_RESULT_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
export const PREVIEW_SIZE_BYTES = 2000
export const BYTES_PER_TOKEN = 4

// ============================================================================
// Types
// ============================================================================

export type PersistedToolResult = {
  filepath: string
  originalSize: number
  isJson: boolean
  preview: string
  hasMore: boolean
}

export type PersistToolResultError = {
  error: string
}

/**
 * Record of a tool result content that was replaced with a persisted reference.
 */
export type ContentReplacementRecord = {
  toolUseId: string
  filepath: string
  originalSize: number
}

// ============================================================================
// Threshold
// ============================================================================

/**
 * Resolve the effective persistence threshold for a tool.
 */
export function getPersistenceThreshold(
  _toolName: string,
  declaredMaxResultSizeChars: number,
): number {
  if (!Number.isFinite(declaredMaxResultSizeChars)) {
    return declaredMaxResultSizeChars
  }
  return Math.min(declaredMaxResultSizeChars, DEFAULT_MAX_RESULT_SIZE_CHARS)
}

// ============================================================================
// Path utilities
// ============================================================================

/**
 * Get the tool results directory for a given cwd and session ID.
 */
export function getToolResultsDir(cwd: string, sessionId: string): string {
  return join(getProjectDir(cwd), sessionId, TOOL_RESULTS_SUBDIR)
}

/**
 * Get the filepath where a tool result would be persisted.
 */
export function getToolResultPath(
  cwd: string,
  sessionId: string,
  id: string,
  isJson: boolean,
): string {
  const ext = isJson ? 'json' : 'txt'
  return join(getToolResultsDir(cwd, sessionId), `${id}.${ext}`)
}

/**
 * Ensure the tool results directory exists.
 */
export async function ensureToolResultsDir(
  cwd: string,
  sessionId: string,
): Promise<void> {
  try {
    await mkdir(getToolResultsDir(cwd, sessionId), { recursive: true })
  } catch {
    // Directory may already exist
  }
}

// ============================================================================
// Preview
// ============================================================================

function generatePreview(
  content: string,
  maxBytes: number,
): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) {
    return { preview: content, hasMore: false }
  }
  return { preview: content.slice(0, maxBytes), hasMore: true }
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Persist a tool result to disk and return information about the persisted file.
 */
export async function persistToolResult(
  content: NonNullable<ToolResultBlockParam['content']>,
  toolUseId: string,
  cwd: string,
  sessionId: string,
): Promise<PersistedToolResult | PersistToolResultError> {
  const isJson = Array.isArray(content)

  if (isJson) {
    const hasNonTextContent = content.some(block => block.type !== 'text')
    if (hasNonTextContent) {
      return {
        error: 'Cannot persist tool results containing non-text content',
      }
    }
  }

  await ensureToolResultsDir(cwd, sessionId)
  const filepath = getToolResultPath(cwd, sessionId, toolUseId, isJson)
  const contentStr = isJson ? jsonStringify(content, undefined, 2) : content

  try {
    await writeFile(filepath, contentStr, { encoding: 'utf-8', flag: 'wx' })
  } catch (error) {
    const err = toError(error)
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      return { error: err.message }
    }
    // EEXIST: already persisted on a prior turn
  }

  const { preview, hasMore } = generatePreview(contentStr, PREVIEW_SIZE_BYTES)

  return {
    filepath,
    originalSize: contentStr.length,
    isJson,
    preview,
    hasMore,
  }
}

/**
 * Build a message for large tool results with preview.
 */
export function buildLargeToolResultMessage(
  result: PersistedToolResult,
): string {
  const sizeStr = `${(result.originalSize / 1024).toFixed(1)} KB`
  let message = `${PERSISTED_OUTPUT_TAG}\n`
  message += `Output too large (${sizeStr}). Full output saved to: ${result.filepath}\n\n`
  message += `Preview (first ${(PREVIEW_SIZE_BYTES / 1024).toFixed(1)} KB):\n`
  message += result.preview
  message += result.hasMore ? '\n...\n' : '\n'
  message += PERSISTED_OUTPUT_CLOSING_TAG
  return message
}
