/**
 * Stub: internal-only assistant install wizard.
 * Dynamically imported in dialogLaunchers.tsx.
 */
import React from 'react'

export function NewInstallWizard(_props: {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}): React.ReactElement {
  return React.createElement('text', null, 'NewInstallWizard stub')
}

export async function computeDefaultInstallDir(): Promise<string> {
  return ''
}
