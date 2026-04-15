/**
 * Stub: internal-only SnapshotUpdateDialog component.
 * Dynamically imported in dialogLaunchers.tsx.
 */
import React from 'react'
import type { AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'

export function SnapshotUpdateDialog(_props: {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (result: 'merge' | 'keep' | 'replace') => void
  onCancel: () => void
}): React.ReactElement {
  return React.createElement('text', null, 'SnapshotUpdateDialog stub')
}
