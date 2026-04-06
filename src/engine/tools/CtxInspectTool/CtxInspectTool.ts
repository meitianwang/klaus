// Feature-gated tool stub — only loaded when feature() returns true
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
export const CtxInspectTool = buildTool({
  name: 'CtxInspectTool',
  inputSchema: z.object({}),
  async prompt() { return '' },
  async call() { return { data: 'Feature not available' } },
  isEnabled: () => false,
} as any)
