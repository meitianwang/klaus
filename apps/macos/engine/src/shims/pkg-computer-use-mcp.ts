/**
 * Shim for @ant/computer-use-mcp and its subpath imports:
 *   @ant/computer-use-mcp
 *   @ant/computer-use-mcp/types
 *   @ant/computer-use-mcp/sentinelApps
 */

// --- base package ---
export function bindSessionContext() {
  return {}
}
export const DEFAULT_GRANT_FLAGS = {}
export function buildComputerUseTools() {
  return []
}
export function createComputerUseMcpServer() {
  return {}
}
export const API_RESIZE_PARAMS = {}
export function targetImageSize() {
  return { width: 0, height: 0 }
}

// --- /sentinelApps ---
export function getSentinelCategory() {
  return undefined
}
