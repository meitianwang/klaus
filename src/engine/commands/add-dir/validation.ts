// Stub: add-dir validation not used in Klaus
export function validateAddDirPath(_path: string): { valid: boolean; error?: string } {
  return { valid: true }
}
export function addDirHelpMessage(_dir?: string): string { return '' }
export function validateDirectoryForWorkspace(_dir: string, _cwd?: string): { valid: boolean; error?: string; resultType?: string; absolutePath?: string } {
  return { valid: true, resultType: 'success', absolutePath: _dir }
}
