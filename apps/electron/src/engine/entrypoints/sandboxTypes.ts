// Stub: Sandbox types for external builds.
// Minimal type definitions matching the Zod schemas in claude-code.

import { z } from 'zod/v4'

export type SandboxNetworkConfig = {
  allowedDomains?: string[]
  allowManagedDomainsOnly?: boolean
  allowUnixSockets?: string[]
  allowAllUnixSockets?: boolean
  allowLocalBinding?: boolean
  httpProxyPort?: number
  socksProxyPort?: number
}

export type SandboxFilesystemConfig = {
  allowWrite?: string[]
  denyWrite?: string[]
  denyRead?: string[]
  allowRead?: string[]
  allowManagedReadPathsOnly?: boolean
}

export type SandboxSettings = {
  enabled?: boolean
  failIfUnavailable?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
  network?: SandboxNetworkConfig
  filesystem?: SandboxFilesystemConfig
  ignoreViolations?: Record<string, string[]>
  enableWeakerNestedSandbox?: boolean
  enableWeakerNetworkIsolation?: boolean
  excludedCommands?: string[]
  ripgrep?: { command: string; args?: string[] }
  [key: string]: unknown
}

export type SandboxIgnoreViolations = Record<string, string[]>

// Runtime Zod schema for SandboxSettings (used by settings validation)
export const SandboxSettingsSchema = () =>
  z
    .object({
      enabled: z.boolean().optional(),
      failIfUnavailable: z.boolean().optional(),
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z.boolean().optional(),
      network: z
        .object({
          allowedDomains: z.array(z.string()).optional(),
          allowManagedDomainsOnly: z.boolean().optional(),
          allowUnixSockets: z.array(z.string()).optional(),
          allowAllUnixSockets: z.boolean().optional(),
          allowLocalBinding: z.boolean().optional(),
          httpProxyPort: z.number().optional(),
          socksProxyPort: z.number().optional(),
        })
        .optional(),
      filesystem: z
        .object({
          allowWrite: z.array(z.string()).optional(),
          denyWrite: z.array(z.string()).optional(),
          denyRead: z.array(z.string()).optional(),
          allowRead: z.array(z.string()).optional(),
          allowManagedReadPathsOnly: z.boolean().optional(),
        })
        .optional(),
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
      enableWeakerNetworkIsolation: z.boolean().optional(),
      excludedCommands: z.array(z.string()).optional(),
      ripgrep: z
        .object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .passthrough()
