/**
 * Stub: internal-only SuggestBackgroundPRTool (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site in tools.ts.
 */
import { z } from 'zod'
import { buildTool } from '../../Tool.js'

export const SuggestBackgroundPRTool = buildTool({
  name: 'SuggestBackgroundPR',
  inputSchema: z.object({}),
  async description() {
    return 'Internal tool (unavailable in this build)'
  },
  async call() {
    return { type: 'result' as const, data: 'SuggestBackgroundPR is not available in this build' }
  },
  isEnabled() {
    return false
  },
})
