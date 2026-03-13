/**
 * Cron MCP tool — exposes CronScheduler as a native tool for Claude.
 *
 * Uses the Claude Agent SDK's in-process MCP server so Claude can manage
 * scheduled tasks via structured tool_use instead of text markers.
 */

import { z } from "zod/v4";
import {
  tool,
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { CronScheduler } from "./cron.js";
import type { CronTask } from "./types.js";

// ---------------------------------------------------------------------------
// Safe ID validation (matches cron-marker.ts)
// ---------------------------------------------------------------------------

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

function validateId(id: string | undefined): string {
  if (!id || !SAFE_ID_RE.test(id)) {
    throw new Error(
      `Invalid task ID "${id ?? ""}". Use only letters, numbers, dash, underscore, dot.`,
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const CRON_TOOL_DESCRIPTION = `Manage scheduled/recurring tasks (cron jobs) and one-shot reminders.

Use this tool whenever the user asks to schedule something, set a reminder, or manage existing tasks:
- "每天早上9点推送新闻" → add recurring task
- "5分钟后提醒我开会" → add one-shot reminder
- "取消每日新闻" → remove task
- "列出定时任务" → list tasks

ACTIONS:
- list: List all tasks with status, schedule, and next run time
- add: Create a new task (requires id, schedule, prompt)
- edit: Modify an existing task (requires id + fields to change)
- remove: Delete a task (requires id)
- enable: Enable a disabled task (requires id)
- disable: Disable a task without deleting (requires id)
- run: Trigger a task immediately (requires id)
- status: Show scheduler status (running state, task count, next wake)

SCHEDULE FORMATS:
- Cron expression: "0 9 * * *" (daily 9am), "*/30 * * * *" (every 30min), "0 9 * * 1" (every Monday 9am)
- Relative time (one-shot): "5m" (5 min), "1h" (1 hour), "2h30m" (2.5 hours)
- ISO 8601 (one-shot): "2026-12-31T23:59:00"

RULES:
- Always generate a descriptive id: lowercase, dashes, no spaces. E.g. "daily-news", "meeting-reminder"
- Always include a name in the user's language
- The prompt field is what Claude receives when the task fires — write a clear, complete prompt
- For tasks that should send results to the user, set deliverChannel: "web" and deliverTo: "*"
- One-shot tasks (relative time / ISO) auto-delete after running`;

// ---------------------------------------------------------------------------
// Zod schema (flat, runtime-validated per action)
// ---------------------------------------------------------------------------

const CronToolInput = {
  action: z.enum([
    "list",
    "add",
    "edit",
    "remove",
    "enable",
    "disable",
    "run",
    "status",
  ]),
  id: z
    .string()
    .optional()
    .describe("Task ID (required for add/edit/remove/enable/disable/run)"),
  name: z.string().optional().describe("Human-readable name"),
  description: z.string().optional().describe("Task description"),
  schedule: z
    .string()
    .optional()
    .describe(
      "Cron expression or relative time (e.g. '0 9 * * *', '5m', '1h')",
    ),
  prompt: z
    .string()
    .optional()
    .describe("Prompt sent to Claude when task fires"),
  model: z.string().optional().describe("Model override for this task"),
  lightContext: z
    .boolean()
    .optional()
    .describe("Use minimal system prompt (faster, cheaper)"),
  timeoutSeconds: z
    .number()
    .optional()
    .describe("Execution timeout in seconds (0=unlimited, default 600)"),
  enabled: z.boolean().optional().describe("Enable/disable (for edit action)"),
  deliverChannel: z
    .string()
    .optional()
    .describe("Delivery channel, e.g. 'web'"),
  deliverTo: z
    .string()
    .optional()
    .describe("Delivery target, e.g. '*' for broadcast"),
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function parseTimeout(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("timeoutSeconds must be a non-negative integer");
  }
  return n;
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function handleList(scheduler: CronScheduler) {
  const tasks = scheduler.getStatus();
  if (tasks.length === 0) {
    return textResult({ message: "No scheduled tasks.", tasks: [] });
  }
  return textResult({ tasks });
}

function handleAdd(scheduler: CronScheduler, params: Record<string, unknown>) {
  const id = validateId(params.id as string | undefined);
  const schedule = params.schedule as string | undefined;
  const prompt = params.prompt as string | undefined;
  if (!schedule) throw new Error("Missing required field: schedule");
  if (!prompt) throw new Error("Missing required field: prompt");

  const task: CronTask = {
    id,
    schedule,
    prompt,
    enabled: true,
    ...(params.name != null ? { name: String(params.name) } : {}),
    ...(params.description != null
      ? { description: String(params.description) }
      : {}),
    ...(params.model != null ? { model: String(params.model) } : {}),
    ...(params.lightContext === true ? { lightContext: true } : {}),
    ...(params.timeoutSeconds != null
      ? { timeoutSeconds: parseTimeout(params.timeoutSeconds) }
      : {}),
    ...buildDeliver(params),
  };

  scheduler.addTask(task);
  return textResult({ message: `Task "${id}" created.`, task });
}

function handleEdit(scheduler: CronScheduler, params: Record<string, unknown>) {
  const id = validateId(params.id as string | undefined);

  const patch: Record<string, unknown> = {};
  if (params.schedule != null) patch.schedule = String(params.schedule);
  if (params.prompt != null) patch.prompt = String(params.prompt);
  if (params.name != null) patch.name = String(params.name);
  if (params.description != null)
    patch.description = String(params.description);
  if (params.model != null) patch.model = String(params.model);
  if (params.lightContext != null) patch.lightContext = params.lightContext;
  if (params.timeoutSeconds != null)
    patch.timeoutSeconds = parseTimeout(params.timeoutSeconds);
  if (params.enabled != null) patch.enabled = params.enabled;

  const deliver = buildDeliver(params);
  if (deliver.deliver) patch.deliver = deliver.deliver;

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to edit. Provide at least one field to change.");
  }

  const ok = scheduler.editTask(id, patch as Partial<CronTask>);
  if (!ok) throw new Error(`Task "${id}" not found.`);
  return textResult({ message: `Task "${id}" updated.` });
}

function handleRemove(
  scheduler: CronScheduler,
  params: Record<string, unknown>,
) {
  const id = validateId(params.id as string | undefined);
  const ok = scheduler.removeTask(id);
  if (!ok) throw new Error(`Task "${id}" not found.`);
  return textResult({ message: `Task "${id}" removed.` });
}

function handleToggle(
  scheduler: CronScheduler,
  params: Record<string, unknown>,
  enable: boolean,
) {
  const id = validateId(params.id as string | undefined);
  const ok = scheduler.editTask(id, { enabled: enable });
  if (!ok) throw new Error(`Task "${id}" not found.`);
  return textResult({
    message: `Task "${id}" ${enable ? "enabled" : "disabled"}.`,
  });
}

async function handleRun(
  scheduler: CronScheduler,
  params: Record<string, unknown>,
) {
  const id = validateId(params.id as string | undefined);
  const result = await scheduler.runTask(id);
  if (!result) throw new Error(`Task "${id}" not found.`);
  return textResult({ message: `Task "${id}" triggered.`, result });
}

function handleStatus(scheduler: CronScheduler) {
  return textResult(scheduler.getSchedulerStatus());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDeliver(params: Record<string, unknown>): {
  deliver?: CronTask["deliver"];
} {
  const channel = params.deliverChannel as string | undefined;
  const to = params.deliverTo as string | undefined;
  if (!channel && !to) return {};
  return {
    deliver: {
      channel: channel ?? "web",
      ...(to ? { to } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Lazy accessor so the tool can be registered before the scheduler exists. */
export interface CronToolContext {
  readonly scheduler: CronScheduler | null;
  ensureScheduler(): Promise<CronScheduler>;
}

export function createCronMcpServer(
  ctx: CronToolContext,
): McpSdkServerConfigWithInstance {
  /** Get or create the scheduler. Throws if creation fails. */
  const getScheduler = async (): Promise<CronScheduler> => {
    return ctx.scheduler ?? (await ctx.ensureScheduler());
  };

  const cronTool = tool(
    "cron",
    CRON_TOOL_DESCRIPTION,
    CronToolInput,
    async (args) => {
      const params = args as Record<string, unknown>;
      const action = params.action as string;
      const scheduler = await getScheduler();

      switch (action) {
        case "list":
          return handleList(scheduler);
        case "add":
          return handleAdd(scheduler, params);
        case "edit":
          return handleEdit(scheduler, params);
        case "remove":
          return handleRemove(scheduler, params);
        case "enable":
          return handleToggle(scheduler, params, true);
        case "disable":
          return handleToggle(scheduler, params, false);
        case "run":
          return handleRun(scheduler, params);
        case "status":
          return handleStatus(scheduler);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  );

  return createSdkMcpServer({
    name: "klaus-cron",
    tools: [cronTool],
  });
}
