/**
 * Stub: internal-only assistant session discovery.
 * Used by the assistant/bridge mode features.
 */

export interface AssistantSession {
  id: string
  name?: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
