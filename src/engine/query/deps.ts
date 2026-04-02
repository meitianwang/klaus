/**
 * Query dependencies (DI) — adapted from claude-code's query/deps.ts.
 */

import { randomUUID } from 'crypto'
import { queryModelWithStreaming } from '../services/api/claude.js'
import { autoCompactIfNeeded } from '../services/compact/autoCompact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'
import type { Message } from '../types/message.js'

export type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: (messages: Message[]) => Message[]
  autocompact: typeof autoCompactIfNeeded
  uuid: () => string
}

export function productionDeps(): QueryDeps {
  return {
    callModel: queryModelWithStreaming,
    microcompact: (messages) => microcompactMessages(messages).messages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
  }
}
