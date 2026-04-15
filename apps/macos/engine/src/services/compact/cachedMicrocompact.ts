// Stub: cachedMicrocompact is not available in external builds.

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

export type CacheEditsBlock = ContentBlockParam[]

export interface PinnedCacheEdits {
  userMessageIndex: number
  block: CacheEditsBlock
}

export interface CachedMCState {
  pinnedEdits: PinnedCacheEdits[]
  toolsSentToAPI: boolean
}

export interface CachedMCConfig {
  maxTokens: number
}

export function createCachedMCState(): CachedMCState {
  return { pinnedEdits: [], toolsSentToAPI: false }
}

export function markToolsSentToAPI(state: CachedMCState): void {
  state.toolsSentToAPI = true
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): CachedMCConfig {
  return { maxTokens: 0 }
}
