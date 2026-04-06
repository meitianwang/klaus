/**
 * Stub: internal-only TungstenTool (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site in tools.ts.
 */
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'

export const TungstenTool = buildTool({
  name: 'Tungsten',
  inputSchema: z.object({}),
  async description(_input: any, _options: any) {
    return 'Internal tool (unavailable in this build)'
  },
  async call(_args: any, _ctx: any) {
    return { type: 'result' as const, data: 'Tungsten is not available in this build' }
  },
  isEnabled() {
    return false
  },
} as any)
