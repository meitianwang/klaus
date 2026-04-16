// Stub: processSlashCommand (not available in Klaus)
export async function processSlashCommand(..._args: unknown[]): Promise<undefined> {
  return undefined
}

export async function processPromptSlashCommand(..._args: unknown[]): Promise<{
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  [key: string]: unknown
}> {
  return { shouldQuery: false }
}

export function formatSkillLoadingMetadata(..._args: unknown[]): string {
  return ''
}
