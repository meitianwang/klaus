/**
 * Shim for @anthropic-ai/mcpb (unavailable internal package).
 * Provides type stubs and a failing McpbManifestSchema so that
 * plugin code compiles and gracefully reports "mcpb not available".
 */

export interface McpbUserConfigurationOption {
  type: string
  description?: string
  required?: boolean
  default?: unknown
  sensitive?: boolean
  title?: string
  multiple?: boolean
  min?: number
  max?: number
}

export type UserConfigSchema = Record<string, McpbUserConfigurationOption>

export interface McpbManifest {
  name: string
  version: string
  author: { name: string; [key: string]: unknown }
  description?: string
  user_config?: UserConfigSchema
  server?: Record<string, unknown>
  [key: string]: unknown
}

type SafeParseSuccess = {
  success: true
  data: McpbManifest
  error?: undefined
}

type SafeParseFailure = {
  success: false
  data?: undefined
  error: {
    flatten: () => {
      fieldErrors: Record<string, string[]>
      formErrors: string[]
    }
  }
}

export const McpbManifestSchema = {
  safeParse(_input: unknown): SafeParseSuccess | SafeParseFailure {
    return {
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: {},
          formErrors: ['mcpb not available'],
        }),
      },
    }
  },
}

export async function getMcpConfigForManifest(
  ..._args: unknown[]
): Promise<Record<string, unknown>> {
  throw new Error('mcpb not available')
}
