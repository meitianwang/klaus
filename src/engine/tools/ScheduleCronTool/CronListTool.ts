import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { cronToHuman } from '../../utils/cron.js'
import { truncate } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getScopedUserId } from '../../bootstrap/state.js'
import { getKlausCronStore } from '../../utils/klausCronBridge.js'
import {
  buildCronListPrompt,
  CRON_LIST_DESCRIPTION,
  CRON_LIST_TOOL_NAME,
  isDurableCronEnabled,
  isKairosCronEnabled,
} from './prompt.js'
const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        cron: z.string(),
        humanSchedule: z.string(),
        prompt: z.string(),
        recurring: z.boolean().optional(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ListOutput = z.infer<OutputSchema>

export const CronListTool = buildTool({
  name: CRON_LIST_TOOL_NAME,
  searchHint: 'list active cron jobs',
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
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return CRON_LIST_DESCRIPTION
  },
  async prompt() {
    return buildCronListPrompt(isDurableCronEnabled())
  },
  async call() {
    const userId = getScopedUserId()
    const store = getKlausCronStore()
    if (!userId || !store) {
      return { data: { jobs: [] } }
    }

    const tasks = store.listUserTasks(userId)
    const jobs = tasks
      .filter(t => t.enabled !== false)
      .map(t => {
        const schedule = typeof t.schedule === 'string' ? t.schedule : JSON.stringify(t.schedule)
        return {
          id: t.id,
          cron: schedule,
          humanSchedule: cronToHuman(schedule),
          prompt: t.prompt,
          ...(!t.deleteAfterRun ? { recurring: true } : {}),
        }
      })
    return { data: { jobs } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        output.jobs.length > 0
          ? output.jobs
              .map(
                j =>
                  `${j.id} — ${j.humanSchedule}${j.recurring ? ' (recurring)' : ' (one-shot)'}: ${truncate(j.prompt, 80, true)}`,
              )
              .join('\n')
          : 'No scheduled jobs.',
    }
  },
} satisfies ToolDef<InputSchema, ListOutput>)
