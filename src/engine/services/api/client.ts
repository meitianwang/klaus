/**
 * Anthropic API client — simplified from claude-code's services/api/client.ts.
 * Only supports Direct API (no Bedrock/Vertex/Foundry/OAuth).
 */

import Anthropic from '@anthropic-ai/sdk'

export interface GetClientOptions {
  apiKey: string
  baseURL?: string
  maxRetries?: number
}

export function createAnthropicClient(options: GetClientOptions): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: options.maxRetries ?? 2,
  })
}
