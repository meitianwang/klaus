// Stub: contextCollapse is not available in external builds.

export interface ContextCollapseHealth {
  totalErrors: number
  totalEmptySpawns: number
  emptySpawnWarningEmitted: boolean
}

export interface ContextCollapseStats {
  collapsedSpans: number
  stagedSpans: number
  health: ContextCollapseHealth
}

export function initContextCollapse(): void {}

export function resetContextCollapse(): void {}

export function isContextCollapseEnabled(): boolean {
  return false
}

export function getStats(): ContextCollapseStats {
  return {
    collapsedSpans: 0,
    stagedSpans: 0,
    health: {
      totalErrors: 0,
      totalEmptySpawns: 0,
      emptySpawnWarningEmitted: false,
    },
  }
}

export function subscribe(_callback: () => void): () => void {
  return () => {}
}
