/**
 * Tool progress types — reconstructed from claude-code's build-time generated types.
 */

export interface BashProgress {
  type: 'bash' | 'bash_progress'
  stdout?: string
  stderr?: string
  interrupted?: boolean
  output?: string
  [key: string]: unknown
}

/** @deprecated Use BashProgress */
export type ShellProgress = BashProgress

export interface AgentToolProgress {
  type: 'agent' | 'agent_progress'
  content?: string
  toolName?: string
  toolInput?: unknown
  message?: unknown
  [key: string]: unknown
}

export interface MCPProgress {
  type: 'mcp' | 'mcp_progress'
  content?: string
  status?: string
  [key: string]: unknown
}

export interface WebSearchProgress {
  type: 'web_search' | 'query_update' | 'search_results_received'
  query?: string
  results?: unknown[]
  resultCount?: number
  [key: string]: unknown
}

export interface SkillToolProgress {
  type: 'skill' | 'skill_progress'
  content?: string
  message?: unknown
  [key: string]: unknown
}

export interface TaskOutputProgress {
  type: 'task_output' | 'waiting_for_task'
  content?: string
  taskDescription?: string
  [key: string]: unknown
}

export interface PowerShellProgress {
  type: 'powershell' | 'powershell_progress'
  stdout?: string
  stderr?: string
  interrupted?: boolean
  output?: string
  [key: string]: unknown
}

export interface SdkWorkflowProgress {
  type: string
  index: number
  label?: string
  status?: string
  [key: string]: unknown
}

export type ToolProgressData =
  | BashProgress
  | AgentToolProgress
  | MCPProgress
  | WebSearchProgress
  | SkillToolProgress
  | TaskOutputProgress
  | PowerShellProgress
