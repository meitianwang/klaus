// Stub: cachedMicrocompact is not available in external builds.

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export interface PinnedCacheEdits {
  userMessageIndex: number
  block: CacheEditsBlock
}

export interface CachedMCState {
  pinnedEdits: PinnedCacheEdits[]
  toolsSentToAPI: boolean
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
}

export interface CachedMCConfig {
  maxTokens: number
  triggerThreshold?: number
  keepRecent?: number
  supportedModels?: string[]
  enabled?: boolean
  systemPromptSuggestSummaries?: boolean
}

export function createCachedMCState(): CachedMCState {
  return {
    pinnedEdits: [],
    toolsSentToAPI: false,
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
  }
}

export function resetCachedMCState(state: CachedMCState): void {
  state.pinnedEdits = []
  state.toolsSentToAPI = false
  state.registeredTools.clear()
  state.toolOrder = []
  state.deletedRefs.clear()
}

export function registerToolResult(
  _state: CachedMCState,
  _toolUseId: string,
): void {}

export function registerToolMessage(
  _state: CachedMCState,
  _groupIds: string[],
): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolsToDelete: string[],
): CacheEditsBlock | null {
  return null
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
