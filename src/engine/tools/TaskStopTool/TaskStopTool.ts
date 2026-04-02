import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, TASK_STOP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z
      .string()
      .optional()
      .describe('The ID of the background task to stop'),
    // shell_id is accepted for backward compatibility with the deprecated KillShell tool
    shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Status message about the operation'),
    task_id: z.string().describe('The ID of the task that was stopped'),
    task_type: z.string().describe('The type of the task that was stopped'),
    command: z
      .string()
      .optional()
      .describe('The command or description of the stopped task'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskStopTool = buildTool({
  name: TASK_STOP_TOOL_NAME,
  searchHint: 'kill a running background task',
  aliases: ['KillShell'],
  maxResultSizeChars: 100_000,
  userFacingName: () => 'Stop Task',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.task_id ?? input.shell_id ?? ''
  },
  async validateInput({ task_id, shell_id }, { getAppState }) {
    const id = task_id ?? shell_id
    if (!id) {
      return {
        result: false,
        message: 'Missing required parameter: task_id',
        errorCode: 1,
      }
    }

    const appState = getAppState()
    const task = (appState as any).tasks?.[id] as
      | { status: string }
      | undefined

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${id}`,
        errorCode: 1,
      }
    }

    if (task.status !== 'running') {
      return {
        result: false,
        message: `Task ${id} is not running (status: ${task.status})`,
        errorCode: 3,
      }
    }

    return { result: true }
  },
  async description() {
    return `Stop a running background task by ID`
  },
  async prompt() {
    return DESCRIPTION
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
  async call(
    { task_id, shell_id },
    { getAppState, setAppState },
  ) {
    const id = task_id ?? shell_id
    if (!id) {
      throw new Error('Missing required parameter: task_id')
    }

    const appState = getAppState()
    const task = (appState as any).tasks?.[id] as
      | { status: string; type?: string; command?: string; description?: string }
      | undefined

    if (!task) {
      throw new Error(`No task found with ID: ${id}`)
    }

    if (task.status !== 'running') {
      throw new Error(`Task ${id} is not running (status: ${task.status})`)
    }

    // Mark the task as stopped in app state
    setAppState(prev => ({
      ...prev,
      tasks: {
        ...(prev as any).tasks,
        [id]: { ...(prev as any).tasks[id], status: 'stopped' },
      },
    }))

    const taskType = task.type ?? 'unknown'
    const command = task.command ?? task.description

    return {
      data: {
        message: `Successfully stopped task: ${id} (${command ?? taskType})`,
        task_id: id,
        task_type: taskType,
        command,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
