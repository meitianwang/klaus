// Feature-gated tool stub
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
export const TerminalCaptureTool = buildTool({
  name: 'TerminalCaptureTool',
  inputSchema: z.object({}),
  async prompt() { return '' },
  async call() { return { data: 'Feature not available' } },
  isEnabled: () => false,
} as any)
