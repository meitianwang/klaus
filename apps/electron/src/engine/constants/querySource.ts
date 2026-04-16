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
  | 'agent_summary'
  | 'auto_dream'
  | 'auto_mode'
  | 'away_summary'
  | 'bash_extract_prefix'
  | 'chrome_mcp'
  | 'extract_memories'
  | 'generate_session_title'
  | 'hook_agent'
  | 'hook_prompt'
  | 'magic_docs'
  | 'mcp_datetime_parse'
  | 'memdir_relevance'
  | 'model_validation'
  | 'permission_explainer'
  | 'prompt_suggestion'
  | `repl_main_thread:${string}`
  | 'session_search'
  | 'side_question'
  | 'skill_improvement'
  | 'skill_improvement_apply'
  | 'speculation'
  | 'tool_use_summary_generation'
  | 'verification_agent'
  | 'web_fetch_apply'
  | 'web_search_tool'
