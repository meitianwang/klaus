/**
 * Session storage utilities — simplified from claude-code's sessionStorage.ts.
 * Stripped: analytics, GrowthBook, bootstrap/state dependency, worktree management.
 * Preserved: type definitions and core path/JSONL utilities.
 */

import type { UUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import type { Entry, TranscriptMessage } from '../types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemMessage,
  UserMessage,
} from '../types/message.js'

type Transcript = (
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
)[]

// ============================================================================
// Path utilities
// ============================================================================

/**
 * Get the projects directory inside the Claude config home.
 */
export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

/**
 * Get the project-specific directory for a given cwd.
 * Sanitizes the path to be filesystem-safe.
 */
export function getProjectDir(cwd: string): string {
  const sanitized = cwd.replace(/[/\\:]/g, '_').replace(/^_+/, '')
  return join(getProjectsDir(), sanitized)
}

/**
 * Get the session directory for a given cwd and session ID.
 */
export function getSessionDir(cwd: string, sessionId: string): string {
  return join(getProjectDir(cwd), sessionId)
}

// ============================================================================
// Transcript message utilities
// ============================================================================

/**
 * Type guard: is this entry a transcript message (user/assistant/attachment/system)?
 */
export function isTranscriptMessage(entry: Entry): entry is TranscriptMessage {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

// ============================================================================
// JSONL read/write
// ============================================================================

/**
 * Append a single entry as a JSONL line to the given file path.
 */
export async function appendEntry(
  filepath: string,
  entry: unknown,
): Promise<void> {
  const { appendFile } = await import('fs/promises')
  const line = JSON.stringify(entry) + '\n'
  await appendFile(filepath, line, 'utf-8')
}

/**
 * Read and parse a JSONL file, returning an array of entries.
 * Returns an empty array if the file does not exist.
 */
export async function readEntries<T = unknown>(
  filepath: string,
): Promise<T[]> {
  let content: string
  try {
    content = await readFile(filepath, 'utf-8')
  } catch {
    return []
  }
  const entries: T[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as T)
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}
