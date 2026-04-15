/**
 * Stub: internal-only agents-platform command (ant-only).
 * Guarded by USER_TYPE === 'ant' at the import site.
 */
import type { Command } from '../../types/command.js'

const agentsPlatform = {
  type: 'local-jsx',
  name: 'agents-platform',
  description: 'Internal agents platform command (unavailable in this build)',
  isEnabled: () => false,
  isHidden: true,
  load: async () => ({
    call: async () => ({ type: 'skip' as const }),
  }),
} satisfies Command

export default agentsPlatform
