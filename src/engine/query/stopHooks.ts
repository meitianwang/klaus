/**
 * Stop hooks — simplified stub for Klaus.
 * Klaus doesn't use the hooks system. handleStopHooks returns empty results.
 * Type signature preserved for compatibility with query.ts.
 */

import type { ToolUseContext } from '../Tool.js'
import type { QuerySource } from '../constants/querySource.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../types/message.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'

type StopHookResult = {
  blockingErrors: Message[]
  preventContinuation: boolean
}

export async function* handleStopHooks(
  _messagesForQuery: Message[],
  _assistantMessages: AssistantMessage[],
  _systemPrompt: SystemPrompt,
  _userContext: { [k: string]: string },
  _systemContext: { [k: string]: string },
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
  _stopHookActive?: boolean,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  StopHookResult
> {
  return { blockingErrors: [], preventContinuation: false }
}
