/**
 * Stub: internal-only TungstenTool (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site in tools.ts.
 */
import { z } from 'zod'
import { buildTool } from '../../Tool.js'

export const TungstenTool = buildTool({
  name: 'Tungsten',
  inputSchema: z.object({}),
  async description() {
    return 'Internal tool (unavailable in this build)'
  },
  async call() {
    return { type: 'result' as const, data: 'Tungsten is not available in this build' }
  },
  isEnabled() {
    return false
  },
})
