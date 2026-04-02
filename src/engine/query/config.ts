/**
 * Query config — adapted from claude-code's query/config.ts.
 * Stripped: GrowthBook, bootstrap/state.
 * All gates hardcoded to false; sessionId generated with randomUUID().
 */

import { randomUUID } from 'crypto'
import type { SessionId } from '../types/ids.js'

export type QueryConfig = {
  sessionId: SessionId

  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

export function buildQueryConfig(): QueryConfig {
  return {
    sessionId: randomUUID() as unknown as SessionId,
    gates: {
      streamingToolExecution: false,
      emitToolUseSummaries: false,
      isAnt: false,
      fastModeEnabled: false,
    },
  }
}
