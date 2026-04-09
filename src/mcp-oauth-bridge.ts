/**
 * MCP OAuth Bridge — shared pending-auth state between McpAuthTool and web.ts callback route.
 *
 * Flow (方案2 — 主流程):
 *   1. McpAuthTool calls performMCPOAuthFlow with externalRedirectUri + onExternalCode
 *   2. onExternalCode registers resolve/reject functions here, keyed by serverName
 *   3. OAuth provider redirects browser to /api/oauth/mcp/callback?server=xxx&code=yyy&state=zzz
 *   4. web.ts route calls resolvePendingAuth(serverName, code)
 *   5. performMCPOAuthFlow's resolveOnce fires, completing token exchange
 *
 * Flow (方案1 — fallback):
 *   If the redirect fails, user pastes the callback URL in the Web UI.
 *   onWaitingForCallback inside performMCPOAuthFlow handles it directly.
 */

interface PendingAuth {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingAuth>();

/**
 * Register resolve/reject for a pending OAuth auth.
 * Called from performMCPOAuthFlow's onExternalCode callback.
 */
export function registerPendingAuth(
  serverName: string,
  resolve: (code: string) => void,
  reject: (err: Error) => void,
): void {
  // Supersede any existing entry for the same server
  const existing = pending.get(serverName);
  if (existing) {
    existing.reject(new Error("Superseded by new auth request"));
  }
  pending.set(serverName, { resolve, reject });
}

/**
 * Resolve a pending auth with the authorization code from the callback route.
 * Returns true if a matching pending auth was found.
 */
export function resolvePendingAuth(serverName: string, code: string): boolean {
  const entry = pending.get(serverName);
  if (!entry) return false;
  pending.delete(serverName);
  entry.resolve(code);
  return true;
}

/**
 * Reject a pending auth (e.g. OAuth error in callback).
 */
export function rejectPendingAuth(serverName: string, error: string): boolean {
  const entry = pending.get(serverName);
  if (!entry) return false;
  pending.delete(serverName);
  entry.reject(new Error(error));
  return true;
}

/**
 * Check if there is a pending auth for a given server.
 */
export function hasPendingAuth(serverName: string): boolean {
  return pending.has(serverName);
}

/**
 * Clean up a pending auth entry after the flow has already resolved/rejected.
 * Does NOT call resolve/reject — caller must ensure the flow is already settled.
 */
export function removePendingAuth(serverName: string): void {
  pending.delete(serverName);
}
