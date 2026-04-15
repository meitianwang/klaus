/**
 * Stub: internal-only REPLTool (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site in tools.ts.
 */
import { z } from 'zod'
import { buildTool } from '../../Tool.js'
import { REPL_TOOL_NAME } from './constants.js'

export const REPLTool = buildTool({
  name: REPL_TOOL_NAME,
  inputSchema: z.object({}),
  async description() {
    return 'Internal REPL tool (unavailable in this build)'
  },
  async call() {
    return { type: 'result' as const, data: 'REPL is not available in this build' }
  },
  isEnabled() {
    return false
  },
})
