/**
 * API provider utilities — simplified from claude-code's utils/model/providers.ts.
 * Klaus only uses the first-party Anthropic API.
 */

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

/**
 * Returns the API provider. Klaus always uses the first-party Anthropic API.
 */
export function getAPIProvider(): APIProvider {
  return 'firstParty'
}

/**
 * Check if the base URL points to a first-party Anthropic API endpoint.
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    return host === 'api.anthropic.com'
  } catch {
    return false
  }
}
