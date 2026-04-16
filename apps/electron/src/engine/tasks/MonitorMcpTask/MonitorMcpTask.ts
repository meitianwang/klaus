import type { TaskStateBase } from '../../Task.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  isBackgrounded?: boolean
}

export function killMonitorMcpTasksForAgent(..._args: unknown[]): void {}
