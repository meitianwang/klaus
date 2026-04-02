/**
 * Tool progress types — reconstructed from claude-code's build-time generated types.
 */

export interface BashProgress {
  type: 'bash'
  stdout?: string
  stderr?: string
  interrupted?: boolean
}

export interface AgentToolProgress {
  type: 'agent'
  content?: string
  toolName?: string
  toolInput?: unknown
}

export interface MCPProgress {
  type: 'mcp'
  content?: string
}

export interface WebSearchProgress {
  type: 'web_search'
  query?: string
  results?: unknown[]
}

export interface SkillToolProgress {
  type: 'skill'
  content?: string
}

export interface TaskOutputProgress {
  type: 'task_output'
  content?: string
}

export interface REPLToolProgress {
  type: 'repl'
  content?: string
}

export type ToolProgressData =
  | BashProgress
  | AgentToolProgress
  | MCPProgress
  | WebSearchProgress
  | SkillToolProgress
  | TaskOutputProgress
  | REPLToolProgress
