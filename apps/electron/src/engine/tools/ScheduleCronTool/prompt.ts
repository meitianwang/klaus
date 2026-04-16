import { isKlausCronAvailable } from '../../utils/klausCronBridge.js'

export const DEFAULT_MAX_AGE_DAYS = 7

/**
 * Klaus cron gate: enabled when the bridge is wired up and cron.enabled is true in settings.
 */
export function isKairosCronEnabled(): boolean {
  return isKlausCronAvailable()
}

/**
 * In Klaus, all tasks are durable (SQLite-backed). Always true.
 */
export function isDurableCronEnabled(): boolean {
  return true
}

export const CRON_CREATE_TOOL_NAME = 'CronCreate'
export const CRON_DELETE_TOOL_NAME = 'CronDelete'
export const CRON_LIST_TOOL_NAME = 'CronList'

export function buildCronCreateDescription(_durableEnabled: boolean): string {
  return 'Schedule a prompt to run at a future time — either recurring on a cron schedule, or once at a specific time. Tasks are persisted and managed by the server. ALWAYS use this instead of Bash sleep for any reminder, delayed action, or scheduled task.'
}

export function buildCronCreatePrompt(_durableEnabled: boolean): string {
  return `Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

IMPORTANT: For ANY request involving reminders, scheduled tasks, delayed actions, or "do X in N minutes/hours" — ALWAYS use this tool. NEVER use Bash sleep, setTimeout, or other workarounds. This tool persists tasks to the server, survives restarts, and delivers results to the user's chat.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local — no timezone conversion needed.

## One-shot tasks (recurring: false)

For "remind me at X" or "at <time>, do Y" requests — fire once then auto-delete.
Pin minute/hour/day-of-month/month to specific values:
  "remind me at 2:30pm today to check the deploy" → cron: "30 14 <today_dom> <today_month> *", recurring: false
  "tomorrow morning, run the smoke test" → cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

## Recurring jobs (recurring: true, the default)

For "every N minutes" / "every hour" / "weekdays at 9am" requests:
  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)

## Avoid the :00 and :30 minute marks when the task allows it

When the user's request is approximate, pick a minute that is NOT 0 or 30:
  "every morning around 9" → "57 8 * * *" or "3 9 * * *" (not "0 9 * * *")
  "hourly" → "7 * * * *" (not "0 * * * *")

Only use minute 0 or 30 when the user names that exact time and clearly means it.

## Persistence

All tasks are stored on the server and survive restarts. One-shot tasks auto-delete after firing. The user can view and manage tasks in their settings page.

Returns a job ID you can pass to ${CRON_DELETE_TOOL_NAME}.`
}

export const CRON_DELETE_DESCRIPTION = 'Cancel a scheduled cron job by ID'
export function buildCronDeletePrompt(_durableEnabled: boolean): string {
  return `Cancel a cron job previously scheduled with ${CRON_CREATE_TOOL_NAME}. Removes it from the server.`
}

export const CRON_LIST_DESCRIPTION = 'List scheduled cron jobs'
export function buildCronListPrompt(_durableEnabled: boolean): string {
  return `List all your scheduled cron jobs on the server.`
}
