/**
 * Main entrypoint for Claude Code Agent SDK types.
 *
 * Re-exports the public SDK API from:
 * - sdk/coreTypes.ts - Common serializable types (messages, configs)
 * - sdk/runtimeTypes.ts - Non-serializable types (callbacks, interfaces)
 */

// Control protocol types for SDK builders
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'

// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'

// Re-export runtime types (callbacks, interfaces with methods)
export * from './sdk/runtimeTypes.js'
