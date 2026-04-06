/**
 * Stub: internal-only REPLTool (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site in tools.ts.
 */
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { REPL_TOOL_NAME } from './constants.js'

export const REPLTool = buildTool({
  name: REPL_TOOL_NAME,
  inputSchema: z.object({}),
  async description(_input: any, _options: any) {
    return 'Internal REPL tool (unavailable in this build)'
  },
  async call(_args: any, _ctx: any) {
    return { type: 'result' as const, data: 'REPL is not available in this build' }
  },
  isEnabled() {
    return false
  },
} as any)
