// Stub: skillSearch remoteSkillLoader (not available in Klaus)
export async function loadRemoteSkill(
  ..._args: unknown[]
): Promise<{
  cacheHit: boolean
  latencyMs: number
  skillPath: string
  content: string
  fileCount: number
  totalBytes: number
  fetchMethod: string
}> {
  throw new Error('Remote skill loading is not available in Klaus')
}
