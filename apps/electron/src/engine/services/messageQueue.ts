/**
 * Klaus-specific MessageQueueManager stub.
 * The full claude-code MessageQueueManager lives in utils/messageQueueManager.ts
 * and depends on Ink UI types. Klaus only needs a minimal object that can be
 * passed through ToolUseContext.
 */

export class MessageQueueManager {
  /** Queue a user message to be sent in the next turn. */
  enqueue(_content: string): void {
    // No-op in Klaus — messages are managed by the session loop
  }

  /** Drain all queued messages. */
  drain(): string[] {
    return []
  }
}
