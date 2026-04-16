// Stub: Re-export the PermissionModeSchema for runtime validation.
// Other schemas are not needed in the external build.

import { z } from 'zod'

export const PermissionModeSchema = () =>
  z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'])
