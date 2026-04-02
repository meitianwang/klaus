/**
 * Permission update types — re-exported from types/permissions.ts.
 * Stripped: settings file read/write, zod schemas, logging.
 * Preserved: type definitions, extractRules utility.
 */

import type {
  AdditionalWorkingDirectory,
  PermissionUpdate,
  PermissionUpdateDestination,
  WorkingDirectorySource,
} from '../../types/permissions.js'
import type { PermissionRuleValue } from './PermissionRule.js'

export type { AdditionalWorkingDirectory, PermissionUpdate, PermissionUpdateDestination, WorkingDirectorySource }

export function extractRules(
  updates: PermissionUpdate[] | undefined,
): PermissionRuleValue[] {
  if (!updates) return []
  return updates.flatMap(update => {
    if ('type' in update && update.type === 'addRules' && 'rules' in update) {
      return (update as { type: 'addRules'; rules: PermissionRuleValue[] }).rules
    }
    return []
  })
}
