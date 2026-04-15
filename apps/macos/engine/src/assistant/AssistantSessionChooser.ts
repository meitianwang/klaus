/**
 * Stub: internal-only AssistantSessionChooser component.
 * Dynamically imported in dialogLaunchers.tsx.
 */
import React from 'react'
import type { AssistantSession } from './sessionDiscovery.js'

export function AssistantSessionChooser(_props: {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}): React.ReactElement {
  return React.createElement('text', null, 'AssistantSessionChooser stub')
}
