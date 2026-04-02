import type { SettingsStore } from "../../settings-store.js";
import type { CronTask, CronSchedulerStatus } from "../../types.js";
import { GatewayError } from "../errors.js";
import type {
  CronSchedulerLike,
  GatewaySettingsSnapshot,
} from "./admin-types.js";

type MutableCronTask = {
  -readonly [K in keyof CronTask]: CronTask[K];
};

const DEFAULT_CRON_SCHEDULER_STATUS: CronSchedulerStatus = {
  running: false,
  taskCount: 0,
  activeJobs: 0,
  runningTasks: 0,
  maxConcurrentRuns: null,
  nextWakeAt: null,
};

function buildSettingsSnapshot(settingsStore: SettingsStore): GatewaySettingsSnapshot {
  return {
    max_sessions: settingsStore.getNumber("max_sessions", 20),
    yolo: settingsStore.getBool("yolo", true),
    web: {
      session_max_age_days: settingsStore.getNumber("web.session_max_age_days", 7),
    },
    transcripts: {
      max_files: settingsStore.getNumber("transcripts.max_files", 200),
      max_age_days: settingsStore.getNumber("transcripts.max_age_days", 30),
    },
    cron: {
      enabled: settingsStore.getBool("cron.enabled", false),
      max_concurrent_runs: settingsStore.getNumber("cron.max_concurrent_runs", 0) || null,
    },
    hooks: settingsStore.getHooks(),
  };
}

function normalizeCronTaskInput(
  input: Record<string, unknown> | CronTask,
  existing?: CronTask,
): CronTask {
  const now = Date.now();
  const record = input as Record<string, unknown>;
  const rawId = "id" in record ? String(record.id ?? "").trim() : existing?.id ?? "";
  if (!rawId) {
    throw GatewayError.badRequest("id is required");
  }

  let schedule: CronTask["schedule"] = existing?.schedule ?? "";
  if ("schedule" in record) {
    const candidate = record.schedule;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (!trimmed) {
        throw GatewayError.badRequest("schedule is required");
      }
      schedule = trimmed;
    } else if (candidate && typeof candidate === "object") {
      schedule = candidate as CronTask["schedule"];
    } else {
      throw GatewayError.badRequest("schedule is required");
    }
  }

  let prompt = existing?.prompt ?? "";
  if ("prompt" in record) {
    prompt = String(record.prompt ?? "").trim();
    if (!prompt) {
      throw GatewayError.badRequest("prompt is required");
    }
  }

  const nextTask: Partial<MutableCronTask> = {
    id: rawId,
    schedule,
    prompt,
    enabled: existing?.enabled !== false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if ("name" in record) {
    nextTask.name = record.name ? String(record.name) : undefined;
  } else if (existing?.name !== undefined) {
    nextTask.name = existing.name;
  }

  if ("description" in record) {
    nextTask.description = record.description ? String(record.description) : undefined;
  } else if (existing?.description !== undefined) {
    nextTask.description = existing.description;
  }

  if ("enabled" in record) {
    nextTask.enabled = Boolean(record.enabled);
  }

  if ("thinking" in record) {
    nextTask.thinking = record.thinking
      ? (String(record.thinking) as CronTask["thinking"])
      : undefined;
  } else if (existing?.thinking !== undefined) {
    nextTask.thinking = existing.thinking;
  }

  if ("lightContext" in record) {
    nextTask.lightContext = Boolean(record.lightContext);
  } else if (existing?.lightContext !== undefined) {
    nextTask.lightContext = existing.lightContext;
  }

  if ("timeoutSeconds" in record) {
    nextTask.timeoutSeconds = record.timeoutSeconds
      ? Math.floor(Number(record.timeoutSeconds))
      : undefined;
  } else if (existing?.timeoutSeconds !== undefined) {
    nextTask.timeoutSeconds = existing.timeoutSeconds;
  }

  if ("deleteAfterRun" in record) {
    nextTask.deleteAfterRun = Boolean(record.deleteAfterRun);
  } else if (existing?.deleteAfterRun !== undefined) {
    nextTask.deleteAfterRun = existing.deleteAfterRun;
  }

  if ("deliver" in record) {
    nextTask.deliver = record.deliver
      ? (record.deliver as CronTask["deliver"])
      : undefined;
  } else if (existing?.deliver !== undefined) {
    nextTask.deliver = existing.deliver;
  }

  if ("webhookUrl" in record) {
    nextTask.webhookUrl = record.webhookUrl ? String(record.webhookUrl) : undefined;
  } else if (existing?.webhookUrl !== undefined) {
    nextTask.webhookUrl = existing.webhookUrl;
  }

  if ("webhookToken" in record) {
    nextTask.webhookToken = record.webhookToken
      ? String(record.webhookToken)
      : undefined;
  } else if (existing?.webhookToken !== undefined) {
    nextTask.webhookToken = existing.webhookToken;
  }

  if ("failureAlert" in record) {
    nextTask.failureAlert = record.failureAlert
      ? (record.failureAlert as CronTask["failureAlert"])
      : undefined;
  } else if (existing?.failureAlert !== undefined) {
    nextTask.failureAlert = existing.failureAlert;
  }

  return nextTask as CronTask;
}

export function getGatewayAdminSettings(params: {
  settingsStore: SettingsStore;
}): GatewaySettingsSnapshot {
  return buildSettingsSnapshot(params.settingsStore);
}

export function updateGatewayAdminSettings(params: {
  settingsStore: SettingsStore;
  input: Record<string, unknown>;
}): GatewaySettingsSnapshot {
  if ("max_sessions" in params.input) {
    const value = Math.floor(Number(params.input.max_sessions));
    if (value > 0) {
      params.settingsStore.set("max_sessions", String(value));
    }
  }
  if ("yolo" in params.input) {
    params.settingsStore.set("yolo", String(Boolean(params.input.yolo)));
  }
  if ("web" in params.input && typeof params.input.web === "object" && params.input.web) {
    const web = params.input.web as Record<string, unknown>;
    if ("session_max_age_days" in web) {
      const value = Number(web.session_max_age_days);
      if (Number.isFinite(value) && value > 0) {
        params.settingsStore.set("web.session_max_age_days", String(value));
      }
    }
  }
  if (
    "transcripts" in params.input &&
    typeof params.input.transcripts === "object" &&
    params.input.transcripts
  ) {
    const transcripts = params.input.transcripts as Record<string, unknown>;
    if ("max_files" in transcripts) {
      const value = Math.floor(Number(transcripts.max_files));
      if (value > 0) {
        params.settingsStore.set("transcripts.max_files", String(value));
      }
    }
    if ("max_age_days" in transcripts) {
      const value = Number(transcripts.max_age_days);
      if (Number.isFinite(value) && value > 0) {
        params.settingsStore.set("transcripts.max_age_days", String(value));
      }
    }
  }
  if ("cron" in params.input && typeof params.input.cron === "object" && params.input.cron) {
    const cron = params.input.cron as Record<string, unknown>;
    if ("enabled" in cron) {
      params.settingsStore.set("cron.enabled", String(Boolean(cron.enabled)));
    }
    if ("max_concurrent_runs" in cron) {
      const value = cron.max_concurrent_runs;
      params.settingsStore.set(
        "cron.max_concurrent_runs",
        value ? String(Math.floor(Number(value))) : "0",
      );
    }
  }

  if ("hooks" in params.input && typeof params.input.hooks === "object") {
    params.settingsStore.setHooks(
      (params.input.hooks ?? {}) as import("../../hooks.js").HooksConfig,
    );
  }

  return buildSettingsSnapshot(params.settingsStore);
}

export function listGatewayCronTasks(params: {
  settingsStore: SettingsStore;
  cronScheduler: CronSchedulerLike | null;
}): {
  tasks: readonly unknown[];
  scheduler: CronSchedulerStatus;
} {
  if (params.cronScheduler) {
    return {
      tasks: params.cronScheduler.getStatus(),
      scheduler: params.cronScheduler.getSchedulerStatus(),
    };
  }

  const tasks = params.settingsStore.listTasks().map((task) => ({
    id: task.id,
    name: task.name,
    description: task.description,
    schedule:
      typeof task.schedule === "string"
        ? task.schedule
        : JSON.stringify(task.schedule),
    prompt: task.prompt,
    enabled: task.enabled !== false,
    nextRun: null,
    lastRun: null,
    consecutiveErrors: 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }));

  return {
    tasks,
    scheduler: {
      ...DEFAULT_CRON_SCHEDULER_STATUS,
      taskCount: tasks.length,
    },
  };
}

export function createGatewayCronTask(params: {
  settingsStore: SettingsStore;
  cronScheduler: CronSchedulerLike | null;
  input: Record<string, unknown> | CronTask;
}): {
  ok: true;
  task: CronTask;
} {
  const task = normalizeCronTaskInput(params.input);
  params.settingsStore.upsertTask(task);
  params.cronScheduler?.addTask(task);
  return { ok: true, task };
}

export function updateGatewayCronTask(params: {
  settingsStore: SettingsStore;
  cronScheduler: CronSchedulerLike | null;
  id: string;
  patch: Record<string, unknown> | Partial<CronTask>;
}): {
  ok: true;
  task: CronTask;
} {
  const existing = params.settingsStore.getTask(params.id);
  if (!existing) {
    throw GatewayError.notFound("task not found");
  }
  const task = normalizeCronTaskInput(
    { ...(params.patch as Record<string, unknown>), id: params.id },
    existing,
  );
  params.settingsStore.upsertTask(task);
  params.cronScheduler?.editTask(params.id, task);
  return { ok: true, task };
}

export function deleteGatewayCronTask(params: {
  settingsStore: SettingsStore;
  cronScheduler: CronSchedulerLike | null;
  id: string;
}): boolean {
  const deleted = params.settingsStore.deleteTask(params.id);
  if (!deleted) {
    return false;
  }
  params.cronScheduler?.removeTask(params.id);
  return true;
}
