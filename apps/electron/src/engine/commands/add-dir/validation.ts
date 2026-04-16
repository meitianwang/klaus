// Stub: add-dir validation not used in Klaus
export function validateAddDirPath(_path: string): { valid: boolean; error?: string } {
  return { valid: true }
}
export function addDirHelpMessage(_dir?: any): string { return '' }
export function validateDirectoryForWorkspace(_dir: string, _ctx?: any): Promise<{ valid: boolean; error?: string; resultType?: string; absolutePath: string } | null> {
  return Promise.resolve({ valid: true, resultType: 'success', absolutePath: _dir })
}
