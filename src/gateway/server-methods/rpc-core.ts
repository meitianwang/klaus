import { loadConfig } from "../../config.js";
import type { MediaFile } from "../../message.js";
import type { Handler } from "../../types.js";
import type { CronTask } from "../../types.js";

export type GatewayRpcCoreContext = {
  listAllStoredSessions(): Promise<readonly unknown[]>;
  deleteStoredSessionByKey(key: string): boolean;
  listCronTasks(): { tasks: readonly unknown[]; scheduler: unknown };
  createCronTask(input: Record<string, unknown> | CronTask): { ok: true; task: CronTask };
  updateCronTask(params: {
    id: string;
    patch: Record<string, unknown> | Partial<CronTask>;
  }): { ok: true; task: CronTask };
  deleteCronTask(id: string): boolean;
  runCronTask(id: string): Promise<unknown>;
  getCronStatus(): unknown;
  processInboundMessage(params: {
    userId: string;
    sessionId: string;
    text: string;
    handler: Handler;
    media?: readonly MediaFile[];
  }): Promise<string | null>;
  listSessionRuntimes(params?: { userId?: string }): readonly unknown[];
  getSessionRuntime(params: {
    userId: string;
    sessionId: string;
  }): unknown | null;
  getSessionAttempts(params: {
    userId: string;
    sessionId: string;
  }): readonly unknown[];
  listSessionAttemptHistories(params?: { userId?: string }): readonly unknown[];
};

export type GatewayRpcCoreDispatchResult =
  | { handled: false }
  | { handled: true; result: unknown }
  | { handled: true; error: string };

export const GATEWAY_RPC_WRITE_METHODS = new Set([
  "config.set",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",
]);

export async function handleGatewayCoreRpcMethod(
  ctx: GatewayRpcCoreContext,
  params: {
    method: string;
    params: Record<string, unknown>;
    userId: string;
    handler: Handler;
  },
): Promise<GatewayRpcCoreDispatchResult> {
  switch (params.method) {
    case "health":
      return {
        handled: true,
        result: {
          ok: true,
          uptime: process.uptime(),
          timestamp: Date.now(),
        },
      };
    case "status":
      return {
        handled: true,
        result: {
          ok: true,
          uptime: process.uptime(),
          pid: process.pid,
          nodeVersion: process.version,
        },
      };
    case "sessions.list":
      try {
        return {
          handled: true,
          result: { sessions: await ctx.listAllStoredSessions() },
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "sessions.delete": {
      const key = params.params.key as string;
      if (!key) {
        return { handled: true, error: "missing key parameter" };
      }
      if (!key.startsWith(`web:${params.userId}:`) && !key.startsWith(`feishu:${params.userId}:`)) {
        return { handled: true, error: "cannot delete another user's session" };
      }
      try {
        return {
          handled: true,
          result: { ok: ctx.deleteStoredSessionByKey(key) },
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "config.get":
      return {
        handled: true,
        result: { config: loadConfig() },
      };
    case "config.set":
      return {
        handled: true,
        error: "config.set is deprecated, use admin API endpoints",
      };
    case "cron.list":
      try {
        return { handled: true, result: ctx.listCronTasks() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "cron.add": {
      try {
        const task = params.params.task as CronTask | undefined;
        if (!task) {
          return { handled: true, error: "missing task parameter" };
        }
        return {
          handled: true,
          result: ctx.createCronTask(task),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "cron.update": {
      const taskId = params.params.id as string;
      if (!taskId) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        const patch = (params.params.patch ?? {}) as Partial<CronTask>;
        return {
          handled: true,
          result: ctx.updateCronTask({ id: taskId, patch }),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "cron.remove": {
      const taskId = params.params.id as string;
      if (!taskId) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return {
          handled: true,
          result: { ok: ctx.deleteCronTask(taskId) },
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "cron.run": {
      const taskId = params.params.id as string;
      if (!taskId) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        const result = await ctx.runCronTask(taskId);
        return {
          handled: true,
          result: { ok: !!result, result },
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "cron.status":
      try {
        return { handled: true, result: ctx.getCronStatus() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "session.runtime.get": {
      const requestedUserId = params.userId;
      const sessionId = (params.params.sessionId as string) ?? "default";
      return {
        handled: true,
        result: ctx.getSessionRuntime({ userId: requestedUserId, sessionId }),
      };
    }
    case "session.runtime.list": {
      const requestedUserId = params.userId;
      return {
        handled: true,
        result: { sessions: ctx.listSessionRuntimes({ userId: requestedUserId }) },
      };
    }
    case "session.attempts.get": {
      const requestedUserId = params.userId;
      const sessionId = (params.params.sessionId as string) ?? "default";
      return {
        handled: true,
        result: {
          sessionId,
          attempts: ctx.getSessionAttempts({ userId: requestedUserId, sessionId }),
        },
      };
    }
    case "session.attempts.list": {
      const requestedUserId = params.userId;
      return {
        handled: true,
        result: {
          sessions: ctx.listSessionAttemptHistories({ userId: requestedUserId }),
        },
      };
    }
    case "chat.send":
    case "voice.send": {
      const text = params.params.text as string;
      const sessionId = (params.params.sessionKey as string) ?? "default";
      if (!text) {
        return { handled: true, error: "missing text parameter" };
      }
      const media = Array.isArray(params.params.media)
        ? (params.params.media as MediaFile[])
        : undefined;
      try {
        await ctx.processInboundMessage({
          userId: params.userId,
          sessionId,
          text,
          handler: params.handler,
          media,
        });
        return { handled: true, result: { ok: true } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "skills.list":
      try {
        const { loadEnabledSkills } = await import("../../skills/index.js");
        const skills = loadEnabledSkills();
        return {
          handled: true,
          result: {
            skills: skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              source: skill.source,
              emoji: skill.metadata?.emoji,
            })),
          },
        };
      } catch {
        return { handled: true, result: { skills: [] } };
      }
    case "usage.get":
      return {
        handled: true,
        result: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUSD: 0,
          sessionCount: 0,
        },
      };
    default:
      return { handled: false };
  }
}
