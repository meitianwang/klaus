/**
 * QuerySource — identifies the origin of a query.
 * Reconstructed from claude-code usage patterns.
 */

export type QuerySource =
  | 'repl_main_thread'
  | 'sdk'
  | 'compact'
  | 'session_memory'
  | 'reactive_compact'
  | 'context_collapse'
  | 'marble_origami'
  | `agent:${string}`
