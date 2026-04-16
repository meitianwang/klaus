/**
 * MCP OAuth Bridge — stub for Electron desktop app.
 * In Electron, MCP OAuth will use localhost callbacks.
 * This is a minimal stub to satisfy McpAuthTool imports.
 */

const pending = new Map<string, { resolve: (code: string) => void; reject: (err: Error) => void }>()

export function registerPendingAuth(
  userId: string,
  serverName: string,
  expectedState: string,
  resolve: (code: string) => void,
  reject: (err: Error) => void,
): void {
  const key = `${userId}:${serverName}`
  pending.set(key, { resolve, reject })
  // Auto-cleanup after 6 minutes
  setTimeout(() => {
    if (pending.has(key)) {
      pending.get(key)!.reject(new Error('OAuth timed out'))
      pending.delete(key)
    }
  }, 6 * 60 * 1000)
}

export function resolvePendingAuth(userId: string, serverName: string, code: string, state: string): boolean {
  const key = `${userId}:${serverName}`
  const entry = pending.get(key)
  if (!entry) return false
  entry.resolve(code)
  pending.delete(key)
  return true
}

export function rejectPendingAuth(userId: string, serverName: string, error: string): boolean {
  const key = `${userId}:${serverName}`
  const entry = pending.get(key)
  if (!entry) return false
  entry.reject(new Error(error))
  pending.delete(key)
  return true
}

export function removePendingAuth(userId: string, serverName: string): void {
  pending.delete(`${userId}:${serverName}`)
}

export function hasPendingAuth(userId: string, serverName: string): boolean {
  return pending.has(`${userId}:${serverName}`)
}
