/**
 * ChannelManager — centralized lifecycle management for channel plugins.
 *
 * Aligned with OpenClaw's ChannelManager (gateway/server-channels.ts):
 * - Per-account AbortController for graceful shutdown
 * - Automatic restart with exponential backoff
 * - Multi-account support per channel
 * - Centralized status tracking via ChannelAccountSnapshot
 * - Process SIGTERM/SIGINT → stopAll()
 * - Adapter-based dispatch (config + gateway)
 */

import type { Handler } from "../types.js";
import type { SettingsStore } from "../settings-store.js";
import type { MessageStore } from "../message-store.js";
import { sleep } from "../retry.js";
import type {
  ChannelPlugin,
  ChannelContext,
  ChannelGatewayContext,
  ChannelAccountSnapshot,
  OutboundContext,
  OutboundDeliveryResult,
  SendOutboundParams,
  TranscriptFn,
  NotifyFn,
} from "./types.js";

// ---------------------------------------------------------------------------
// Backoff constants (aligned with OpenClaw: 5s→10s→30s→60s→5min, max 10)
// ---------------------------------------------------------------------------

const BACKOFF_STEPS_MS = [5_000, 10_000, 30_000, 60_000, 300_000];
const MAX_RESTART_ATTEMPTS = 10;

function backoffMs(attempt: number): number {
  return BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Runtime key: "channelId" or "channelId:accountId" for multi-account
// ---------------------------------------------------------------------------

function runtimeKey(channelId: string, accountId: string): string {
  return accountId === "default" ? channelId : `${channelId}:${accountId}`;
}

// ---------------------------------------------------------------------------
// Per-account runtime state
// ---------------------------------------------------------------------------

interface AccountRuntime {
  plugin: ChannelPlugin;
  accountId: string;
  controller: AbortController;
  promise: Promise<void> | null;
  snapshot: ChannelAccountSnapshot;
}

// ---------------------------------------------------------------------------
// ChannelManagerOptions
// ---------------------------------------------------------------------------

interface ChannelManagerOptions {
  readonly handler: Handler;
  readonly settingsStore: SettingsStore;
  readonly messageStore: MessageStore;
  readonly buildNotify: (ownerId?: string) => NotifyFn;
  readonly services?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelManager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private readonly plugins: ChannelPlugin[] = [];
  private readonly runtimes = new Map<string, AccountRuntime>();
  private readonly opts: ChannelManagerOptions;
  private globalAbort = new AbortController();
  private shutdownHandler: (() => void) | null = null;

  constructor(opts: ChannelManagerOptions) {
    this.opts = opts;
  }

  register(plugin: ChannelPlugin): void {
    this.plugins.push(plugin);
  }

  getPlugins(): readonly ChannelPlugin[] {
    return this.plugins;
  }

  getPlugin(id: string): ChannelPlugin | undefined {
    return this.plugins.find((p) => p.meta.id === id);
  }

  /** Start all enabled channels and accounts. */
  async startAll(): Promise<void> {
    if (this.globalAbort.signal.aborted) {
      this.globalAbort = new AbortController();
    }
    this.registerShutdownHandlers();

    const promises: Promise<void>[] = [];

    for (const plugin of this.plugins) {
      if (!plugin.config) {
        console.warn(`[ChannelManager] ${plugin.meta.label} has no config adapter, skipping`);
        continue;
      }
      const accountIds = await plugin.config.listAccountIds(this.opts.settingsStore);
      for (const accountId of accountIds) {
        const account = await plugin.config.resolveAccount(this.opts.settingsStore, accountId);
        if (!account) continue;
        if (!(await plugin.config.isEnabled(account, this.opts.settingsStore))) continue;
        if (!plugin.config.isConfigured(account, this.opts.settingsStore)) continue;
        const label = accountId === "default" ? plugin.meta.label : `${plugin.meta.label}:${accountId}`;
        console.log(`[ChannelManager] ${label} enabled`);
        promises.push(this.startAccount(plugin, accountId));
      }
    }

    if (promises.length === 0) {
      console.warn("[ChannelManager] No channels enabled");
      return;
    }

    await Promise.all(promises);
  }

  /** Stop a specific channel (all accounts) or a specific account. */
  async stop(channelId: string, accountId?: string): Promise<void> {
    // Unregister plugin skill directories

    if (accountId) {
      const key = runtimeKey(channelId, accountId);
      const rt = this.runtimes.get(key);
      if (rt) {
        rt.controller.abort();
        if (rt.promise) await rt.promise;
      }
    } else {
      // Stop all accounts for this channel
      const toStop: AccountRuntime[] = [];
      for (const [key, rt] of this.runtimes) {
        if (key === channelId || key.startsWith(`${channelId}:`)) {
          toStop.push(rt);
        }
      }
      for (const rt of toStop) rt.controller.abort();
      await Promise.allSettled(toStop.filter((r) => r.promise).map((r) => r.promise!));
    }
  }

  /** Stop all channels. */
  async stopAll(): Promise<void> {
    this.globalAbort.abort();
    const promises = [...this.runtimes.values()]
      .filter((r) => r.promise)
      .map((r) => r.promise!);
    await Promise.allSettled(promises);
    this.runtimes.clear();
    this.unregisterShutdownHandlers();
  }

  /** Get snapshots for all running accounts. */
  status(): Map<string, ChannelAccountSnapshot> {
    const result = new Map<string, ChannelAccountSnapshot>();
    for (const [key, rt] of this.runtimes) {
      result.set(key, { ...rt.snapshot });
    }
    return result;
  }

  /**
   * Hot-start a channel account.
   * Stops existing instance, re-resolves config, starts with full lifecycle.
   */
  hotStart(channelId: string, accountId = "default"): void {
    const plugin = this.plugins.find((p) => p.meta.id === channelId);
    if (!plugin) {
      console.error(`[ChannelManager] hotStart: unknown channel "${channelId}"`);
      return;
    }

    if (!plugin.config) {
      console.warn(`[ChannelManager] hotStart: "${channelId}" has no config adapter`);
      return;
    }

    // Stop existing instance first, then start new one
    void this.stop(channelId, accountId).then(async () => {
      const account = await plugin.config!.resolveAccount(this.opts.settingsStore, accountId);
      if (!account || !(await plugin.config!.isEnabled(account, this.opts.settingsStore))) {
        console.warn(`[ChannelManager] hotStart: "${channelId}:${accountId}" not configured/enabled`);
        return;
      }
      this.startAccount(plugin, accountId).catch((err) => {
        console.error(`[ChannelManager] ${plugin.meta.label} hot-start failed:`, err);
      });
    });
  }

  /** Build the deliverers map for cron scheduler. Prefers outbound adapter over legacy deliver. */
  buildDeliverers(): Map<string, (to: string, text: string) => Promise<void>> {
    const result = new Map<string, (to: string, text: string) => Promise<void>>();
    for (const plugin of this.plugins) {
      if (plugin.outbound) {
        const outbound = plugin.outbound;
        const store = this.opts.settingsStore;
        const pid = plugin.meta.id;
        result.set(pid, async (to, text) => {
          const account = (await plugin.config?.resolveAccount(store, "default")) ?? {};
          const ctx: OutboundContext = {
            accountId: "default",
            sessionKey: "",
            chatType: "direct",
            targetId: to,
            config: account,
          };
          await outbound.sendText(ctx, text);
        });
      } else if (plugin.deliver) {
        result.set(plugin.meta.id, plugin.deliver);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async startAccount(plugin: ChannelPlugin, accountId: string): Promise<void> {
    // Plugin skill dirs — engine handles skill loading via loadSkillsDir

    const key = runtimeKey(plugin.meta.id, accountId);
    const controller = new AbortController();

    this.globalAbort.signal.addEventListener("abort", () => controller.abort(), { once: true });

    const snapshot: ChannelAccountSnapshot = {
      accountId,
      channelId: plugin.meta.id,
      enabled: true,
      configured: true,
      running: false,
      connected: false,
      restartPending: false,
      reconnectAttempts: 0,
      healthState: "unknown",
      busy: false,
      activeRuns: 0,
      state: "stopped",
      restartCount: 0,
    };

    const runtime: AccountRuntime = {
      plugin,
      accountId,
      controller,
      promise: null,
      snapshot,
    };
    this.runtimes.set(key, runtime);

    runtime.promise = this.runWithRestart(runtime);
    await runtime.promise;
  }

  private async runWithRestart(runtime: AccountRuntime): Promise<void> {
    const { plugin, accountId, controller } = runtime;
    const label = accountId === "default"
      ? plugin.meta.label
      : `${plugin.meta.label}:${accountId}`;
    let attempt = 0;

    while (!controller.signal.aborted) {
      Object.assign(runtime.snapshot, { state: "starting", running: true, restartPending: false });

      try {
        const ctx = this.buildContext(plugin, controller.signal);
        Object.assign(runtime.snapshot, {
          state: "running",
          restartCount: attempt,
          startedAt: Date.now(),
          lastStartAt: Date.now(),
        });

        if (!plugin.gateway) {
          throw new Error(`Channel "${plugin.meta.id}" has no gateway adapter`);
        }
        const gatewayCtx = this.buildGatewayContext(ctx, plugin, runtime);
        await plugin.gateway.startAccount(gatewayCtx);

        Object.assign(runtime.snapshot, { state: "stopped", running: false, lastStopAt: Date.now() });
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ChannelManager] ${label} crashed: ${errorMsg}`);

        if (controller.signal.aborted) {
          Object.assign(runtime.snapshot, { state: "stopped", running: false, lastStopAt: Date.now() });
          return;
        }

        attempt++;
        Object.assign(runtime.snapshot, {
          state: "errored",
          running: false,
          lastError: errorMsg,
          restartCount: attempt,
          lastStopAt: Date.now(),
        });

        if (attempt > MAX_RESTART_ATTEMPTS) {
          console.error(`[ChannelManager] ${label} exceeded max restart attempts (${MAX_RESTART_ATTEMPTS}), giving up`);
          Object.assign(runtime.snapshot, { healthState: "unhealthy" });
          return;
        }

        const delay = backoffMs(attempt - 1);
        console.log(`[ChannelManager] ${label} restarting in ${delay / 1000}s (attempt ${attempt}/${MAX_RESTART_ATTEMPTS})`);
        Object.assign(runtime.snapshot, { restartPending: true, reconnectAttempts: attempt });

        await sleep(delay, controller.signal);
      }
    }

    Object.assign(runtime.snapshot, { state: "stopped", running: false, lastStopAt: Date.now() });
  }

  private buildContext(plugin: ChannelPlugin, signal: AbortSignal, _accountId = "default"): ChannelContext {
    // ownerId is resolved lazily inside notify so we don't need to await here.
    // buildNotify accepts undefined and falls back to broadcastEvent.
    const transcript: TranscriptFn = (sessionKey, role, text) =>
      this.opts.messageStore.append(sessionKey, role, text);

    // Resolve ownerId lazily: fire-and-forget per-message lookup via async closure.
    const store = this.opts.settingsStore;
    const channelId = plugin.meta.id;
    const buildNotify = this.opts.buildNotify;
    const notify: import("./types.js").NotifyFn = (sessionKey, role, text) => {
      void store.get(`channel.${channelId}.owner_id`).then((ownerId) => {
        buildNotify(ownerId ?? undefined)(sessionKey, role, text);
      });
    };

    return {
      handler: this.opts.handler,
      transcript,
      notify,
      signal,
      services: this.opts.services,
    };
  }

  private buildGatewayContext(
    base: ChannelContext,
    plugin: ChannelPlugin,
    runtime: AccountRuntime,
  ): ChannelGatewayContext {
    const account = plugin.config?.resolveAccount(this.opts.settingsStore, runtime.accountId) ?? {};

    const sendOutbound = plugin.outbound
      ? async (params: SendOutboundParams): Promise<OutboundDeliveryResult> => {
          const outCtx: OutboundContext = {
            accountId: runtime.accountId,
            sessionKey: params.sessionKey,
            chatType: params.chatType,
            targetId: params.targetId,
            replyToMessageId: params.replyToMessageId,
            threadId: params.threadId,
            config: account,
          };
          return plugin.outbound!.sendText(outCtx, params.text);
        }
      : undefined;

    return {
      ...base,
      accountId: runtime.accountId,
      account,
      getStatus: () => ({ ...runtime.snapshot }),
      setStatus: (patch) => {
        const { accountId: _, channelId: __, ...safe } = patch;
        Object.assign(runtime.snapshot, safe);
      },
      sendOutbound,
    };
  }

  private registerShutdownHandlers(): void {
    if (this.shutdownHandler) return;
    const shutdown = () => {
      console.log("[ChannelManager] Shutdown signal received");
      this.globalAbort.abort();
    };
    this.shutdownHandler = shutdown;
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  private unregisterShutdownHandlers(): void {
    if (!this.shutdownHandler) return;
    process.removeListener("SIGTERM", this.shutdownHandler);
    process.removeListener("SIGINT", this.shutdownHandler);
    this.shutdownHandler = null;
  }
}
