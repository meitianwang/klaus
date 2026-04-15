/**
 * Stub: internal-only snip projection module.
 * Guarded by feature('HISTORY_SNIP') at all import sites.
 */
import type { Message } from '../../types/message.js'

export function isSnipBoundaryMessage(_message: Message): boolean {
  return false
}

export function projectSnippedView<T extends Message>(messages: T[]): T[] {
  return messages
}
