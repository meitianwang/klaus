/**
 * Stub: internal-only VerifyPlanExecutionTool.
 * Guarded by CLAUDE_CODE_VERIFY_PLAN === 'true' at the import site in tools.ts.
 */
import { z } from 'zod'
import { buildTool } from '../../Tool.js'
import { VERIFY_PLAN_EXECUTION_TOOL_NAME } from './constants.js'

export const VerifyPlanExecutionTool = buildTool({
  name: VERIFY_PLAN_EXECUTION_TOOL_NAME,
  inputSchema: z.object({}),
  async description() {
    return 'Internal tool (unavailable in this build)'
  },
  async call() {
    return { type: 'result' as const, data: 'VerifyPlanExecution is not available in this build' }
  },
  isEnabled() {
    return false
  },
})
