import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { cronToHuman, parseCronExpression } from '../../utils/cron.js'
import { nextCronRunMs } from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import { getScopedUserId } from '../../bootstrap/state.js'
import { getKlausCronStore, getKlausCronScheduler } from '../../utils/klausCronBridge.js'
import {
  buildCronCreateDescription,
  buildCronCreatePrompt,
  CRON_CREATE_TOOL_NAME,
  isKairosCronEnabled,
  isDurableCronEnabled,
} from './prompt.js'
const MAX_JOBS = 50

const inputSchema = lazySchema(() =>
  z.strictObject({
    cron: z
      .string()
      .describe(
        'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
      ),
    prompt: z.string().describe('The prompt to enqueue at each fire time.'),
    recurring: semanticBoolean(z.boolean().optional()).describe(
      `true (default) = fire on every cron match. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.`,
    ),
    name: z.string().optional().describe('Optional human-readable name for the task.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    humanSchedule: z.string(),
    recurring: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type CreateOutput = z.infer<OutputSchema>

export const CronCreateTool = buildTool({
  name: CRON_CREATE_TOOL_NAME,
  searchHint: 'schedule a recurring or one-shot prompt',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isKairosCronEnabled()
  },
  toAutoClassifierInput(input) {
    return `${input.cron}: ${input.prompt}`
  },
  async description() {
    return buildCronCreateDescription(isDurableCronEnabled())
  },
  async prompt() {
    return buildCronCreatePrompt(isDurableCronEnabled())
  },
  getPath() {
    return ''
  },
  async validateInput(input): Promise<ValidationResult> {
    if (!parseCronExpression(input.cron)) {
      return {
        result: false,
        message: `Invalid cron expression '${input.cron}'. Expected 5 fields: M H DoM Mon DoW.`,
        errorCode: 1,
      }
    }
    if (nextCronRunMs(input.cron, Date.now()) === null) {
      return {
        result: false,
        message: `Cron expression '${input.cron}' does not match any calendar date in the next year.`,
        errorCode: 2,
      }
    }
    const userId = getScopedUserId()
    if (!userId) {
      return { result: false, message: 'No user context available.', errorCode: 3 }
    }
    const store = getKlausCronStore()
    if (!store) {
      return { result: false, message: 'Cron system not available.', errorCode: 4 }
    }
    const tasks = store.listUserTasks(userId)
    if (tasks.length >= MAX_JOBS) {
      return {
        result: false,
        message: `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`,
        errorCode: 5,
      }
    }
    return { result: true }
  },
  async call({ cron, prompt, recurring = true, name }) {
    const userId = getScopedUserId()!
    const store = getKlausCronStore()!
    const scheduler = getKlausCronScheduler()

    const id = `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const now = Date.now()

    const task = {
      id,
      userId,
      name: name ?? prompt.slice(0, 40),
      schedule: cron,
      prompt,
      enabled: true,
      deleteAfterRun: !recurring,
      createdAt: now,
      updatedAt: now,
    }

    store.upsertTask(task)
    scheduler?.addTask(task)

    return {
      data: {
        id,
        humanSchedule: cronToHuman(cron),
        recurring,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.recurring
        ? `Scheduled recurring job ${output.id} (${output.humanSchedule}). Persisted to server. Use CronDelete to cancel.`
        : `Scheduled one-shot task ${output.id} (${output.humanSchedule}). It will fire once then auto-delete.`,
    }
  },
} satisfies ToolDef<InputSchema, CreateOutput>)
