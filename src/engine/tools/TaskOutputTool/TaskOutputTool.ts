/**
 * TaskOutputTool — simplified from claude-code's TaskOutputTool/TaskOutputTool.tsx.
 * Stripped: React/Ink rendering, LocalShellTask/RemoteAgentTask state types,
 *           task framework updateTaskState, formatTaskOutput, getTaskOutput,
 *           theme, keyboard shortcuts.
 * Preserved: core task output retrieval with blocking/non-blocking mode,
 *            input/output schema, prompt.
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolUseContext,
  type ValidationResult,
} from '../../Tool.js'
import type { TaskOutputProgress } from '../../types/tools.js'
import { AbortError } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { TASK_OUTPUT_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().describe('The task ID to get output from'),
    block: z
      .boolean()
      .default(true)
      .describe('Whether to wait for completion'),
    timeout: z
      .number()
      .min(0)
      .max(600000)
      .default(30000)
      .describe('Max wait time in ms'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type TaskOutputToolInput = z.infer<InputSchema>

/**
 * Simplified task state — Klaus tracks tasks in AppState.
 */
interface TaskState {
  id: string
  type: string
  status: 'running' | 'pending' | 'completed' | 'failed' | 'killed'
  description: string
  output?: string
  error?: string
  exitCode?: number | null
  prompt?: string
  result?: string
}

type TaskOutput = {
  task_id: string
  task_type: string
  status: string
  description: string
  output: string
  exitCode?: number | null
  error?: string
  prompt?: string
  result?: string
}

type TaskOutputToolOutput = {
  retrieval_status: 'success' | 'timeout' | 'not_ready'
  task: TaskOutput | null
}

function getTaskOutputData(task: TaskState): TaskOutput {
  return {
    task_id: task.id,
    task_type: task.type,
    status: task.status,
    description: task.description,
    output: task.result ?? task.output ?? '',
    exitCode: task.exitCode,
    error: task.error,
    prompt: task.prompt,
    result: task.result,
  }
}

function getTaskFromAppState(
  context: ToolUseContext,
  taskId: string,
): TaskState | undefined {
  const appState = context.getAppState()
  const tasks = (appState as { tasks?: Record<string, TaskState> })
    .tasks
  return tasks?.[taskId]
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTaskCompletion(
  taskId: string,
  context: ToolUseContext,
  timeoutMs: number,
): Promise<TaskState | null> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    if (context.abortController.signal.aborted) {
      throw new AbortError()
    }
    const task = getTaskFromAppState(context, taskId)
    if (!task) return null
    if (task.status !== 'running' && task.status !== 'pending') {
      return task
    }
    await sleep(100)
  }
  // Timeout — return current state
  return getTaskFromAppState(context, taskId) ?? null
}

export const TaskOutputTool = buildTool({
  name: TASK_OUTPUT_TOOL_NAME,
  searchHint: 'read output/logs from a background task',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  aliases: ['AgentOutputTool', 'BashOutputTool'],

  userFacingName() {
    return 'Task Output'
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  async description() {
    return 'Read output from a background task'
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return true
  },

  toAutoClassifierInput(input: TaskOutputToolInput) {
    return input.task_id
  },

  async prompt() {
    return `Retrieves output from a running or completed background task.

- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs are returned by Bash when using run_in_background=true`
  },

  async validateInput(
    { task_id }: TaskOutputToolInput,
    context: ToolUseContext,
  ): Promise<ValidationResult> {
    if (!task_id) {
      return {
        result: false,
        message: 'Task ID is required',
        errorCode: 1,
      }
    }
    const task = getTaskFromAppState(context, task_id)
    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${task_id}`,
        errorCode: 2,
      }
    }
    return { result: true }
  },

  async call(
    input: TaskOutputToolInput,
    toolUseContext,
    _canUseTool,
    _parentMessage,
    onProgress?,
  ) {
    const { task_id, block, timeout } = input
    const task = getTaskFromAppState(toolUseContext, task_id)

    if (!task) {
      throw new Error(`No task found with ID: ${task_id}`)
    }

    if (!block) {
      // Non-blocking: return current state
      if (
        task.status !== 'running' &&
        task.status !== 'pending'
      ) {
        return {
          data: {
            retrieval_status: 'success' as const,
            task: getTaskOutputData(task),
          },
        }
      }
      return {
        data: {
          retrieval_status: 'not_ready' as const,
          task: getTaskOutputData(task),
        },
      }
    }

    // Blocking: wait for completion
    if (onProgress) {
      onProgress({
        toolUseID: `task-output-waiting-${Date.now()}`,
        data: {
          type: 'task_output' as const,
          content: `Waiting for task: ${task.description}`,
        },
      })
    }

    const completedTask = await waitForTaskCompletion(
      task_id,
      toolUseContext,
      timeout,
    )

    if (!completedTask) {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: null,
        },
      }
    }

    if (
      completedTask.status === 'running' ||
      completedTask.status === 'pending'
    ) {
      return {
        data: {
          retrieval_status: 'timeout' as const,
          task: getTaskOutputData(completedTask),
        },
      }
    }

    return {
      data: {
        retrieval_status: 'success' as const,
        task: getTaskOutputData(completedTask),
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    data: TaskOutputToolOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const parts: string[] = []
    parts.push(
      `<retrieval_status>${data.retrieval_status}</retrieval_status>`,
    )
    if (data.task) {
      parts.push(`<task_id>${data.task.task_id}</task_id>`)
      parts.push(`<task_type>${data.task.task_type}</task_type>`)
      parts.push(`<status>${data.task.status}</status>`)
      if (
        data.task.exitCode !== undefined &&
        data.task.exitCode !== null
      ) {
        parts.push(
          `<exit_code>${data.task.exitCode}</exit_code>`,
        )
      }
      if (data.task.output?.trim()) {
        parts.push(
          `<output>\n${data.task.output.trimEnd()}\n</output>`,
        )
      }
      if (data.task.error) {
        parts.push(`<error>${data.task.error}</error>`)
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: parts.join('\n\n'),
    }
  },
} satisfies ToolDef<InputSchema, TaskOutputToolOutput, TaskOutputProgress>)
