import { memoize } from 'lodash-es'

// Stub: mcpSkills (not available in Klaus)
export const fetchMcpSkillsForClient = memoize(
  async (..._args: unknown[]): Promise<unknown[]> => [],
)

export function getMcpSkillCommands(..._args: unknown[]): unknown[] {
  return []
}
