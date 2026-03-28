/**
 * ChannelManager — centralized lifecycle management for channel plugins.
 *
 * Inspired by OpenClaw's ChannelManager (gateway/server-channels.ts):
 * - Per-channel AbortController for graceful shutdown
 * - Automatic restart with exponential backoff
 * - Centralized status tracking
 * - Process SIGTERM/SIGINT → stopAll()
 */

import type { Handler } from "../types.js";
import type { SettingsStore } from "../settings-store.js";
import type { MessageStore } from "../message-store.js";
import { sleep } from "../retry.js";
import type {
  ChannelPlugin,
  ChannelContext,
  ChannelStatus,
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
// ChannelRuntime — per-channel internal state
// ---------------------------------------------------------------------------

interface ChannelRuntime {
  plugin: ChannelPlugin;
  controller: AbortController;
  promise: Promise<void> | null;
  status: ChannelStatus;
}

// ---------------------------------------------------------------------------
// ChannelManagerOptions
// ---------------------------------------------------------------------------

interface ChannelManagerOptions {
  readonly handler: Handler;
  readonly settingsStore: SettingsStore;
  readonly messageStore: MessageStore;
  /**
   * Build the notify callback for a given ownerId.
   * Called once per channel at resolve time.
   */
  readonly buildNotify: (ownerId?: string) => NotifyFn;
  /**
   * Extra services to pass in ChannelContext.services (for web channel).
   */
  readonly services?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelManager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private readonly plugins: ChannelPlugin[] = [];
  private readonly runtimes = new Map<string, ChannelRuntime>();
  private readonly opts: ChannelManagerOptions;
  private globalAbort = new AbortController();
  private shutdownHandler: (() => void) | null = null;

  constructor(opts: ChannelManagerOptions) {
    this.opts = opts;
  }

  /** Register a channel plugin. */
  register(plugin: ChannelPlugin): void {
    this.plugins.push(plugin);
  }

  /** Start all enabled channels. Resolves when all channels stop. */
  async startAll(): Promise<void> {
    // Reset abort controller so startAll() can be called again after stopAll()
    if (this.globalAbort.signal.aborted) {
      this.globalAbort = new AbortController();
    }
    this.registerShutdownHandlers();

    const enabled: ChannelPlugin[] = [];
    for (const plugin of this.plugins) {
      const config = plugin.resolveConfig(this.opts.settingsStore);
      if (config) {
        enabled.push(plugin);
        console.log(`[ChannelManager] ${plugin.meta.label} enabled`);
      }
    }

    if (enabled.length === 0) {
      console.warn("[ChannelManager] No channels enabled");
      return;
    }

    const promises: Promise<void>[] = [];
    for (const plugin of enabled) {
      promises.push(this.startChannel(plugin));
    }

    await Promise.all(promises);
  }

  /** Stop a specific channel gracefully. */
  async stop(channelId: string): Promise<void> {
    const runtime = this.runtimes.get(channelId);
    if (!runtime) return;
    runtime.controller.abort();
    if (runtime.promise) {
      await runtime.promise;
    }
  }

  /** Stop all channels (called on SIGTERM/SIGINT). */
  async stopAll(): Promise<void> {
    this.globalAbort.abort();
    const promises = [...this.runtimes.values()]
      .filter((r) => r.promise)
      .map((r) => r.promise!);
    await Promise.allSettled(promises);
    this.runtimes.clear();
    this.unregisterShutdownHandlers();
  }

  /** Get status of all channels. */
  status(): Map<string, ChannelStatus> {
    const result = new Map<string, ChannelStatus>();
    for (const [id, runtime] of this.runtimes) {
      result.set(id, { ...runtime.status });
    }
    return result;
  }

  /**
   * Hot-start a channel (e.g. after admin panel configuration).
   * Stops any existing instance, re-resolves config, and starts with auto-restart.
   * Non-blocking — the returned promise resolves immediately after launch.
   */
  hotStart(channelId: string): void {
    const plugin = this.plugins.find((p) => p.meta.id === channelId);
    if (!plugin) {
      console.error(`[ChannelManager] hotStart: unknown channel "${channelId}"`);
      return;
    }

    const config = plugin.resolveConfig(this.opts.settingsStore);
    if (!config) {
      console.warn(`[ChannelManager] hotStart: channel "${channelId}" not configured`);
      return;
    }

    // Stop existing instance if running
    const existing = this.runtimes.get(channelId);
    if (existing) {
      existing.controller.abort();
    }

    // Start with full lifecycle management (abort, restart, status tracking)
    this.startChannel(plugin).catch((err) => {
      console.error(`[ChannelManager] ${plugin.meta.label} hot-start failed:`, err);
    });
  }

  /** Get the deliver function for a channel, if available. */
  getDeliverer(channelId: string): ((to: string, text: string) => Promise<void>) | undefined {
    const runtime = this.runtimes.get(channelId);
    return runtime?.plugin.deliver;
  }

  /** Build the deliverers map for cron scheduler. Uses registered plugins (not runtimes). */
  buildDeliverers(): Map<string, (to: string, text: string) => Promise<void>> {
    const result = new Map<string, (to: string, text: string) => Promise<void>>();
    for (const plugin of this.plugins) {
      if (plugin.deliver) {
        result.set(plugin.meta.id, plugin.deliver);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async startChannel(plugin: ChannelPlugin): Promise<void> {
    const id = plugin.meta.id;
    const controller = new AbortController();

    // Link to global abort
    this.globalAbort.signal.addEventListener("abort", () => controller.abort(), { once: true });

    const runtime: ChannelRuntime = {
      plugin,
      controller,
      promise: null,
      status: { state: "stopped", restartCount: 0 },
    };
    this.runtimes.set(id, runtime);

    runtime.promise = this.runWithRestart(runtime);
    await runtime.promise;
  }

  private async runWithRestart(runtime: ChannelRuntime): Promise<void> {
    const { plugin, controller } = runtime;
    const id = plugin.meta.id;
    let attempt = 0;

    while (!controller.signal.aborted) {
      runtime.status.state = "starting";

      try {
        const ctx = this.buildContext(plugin, controller.signal);
        runtime.status = { state: "running", restartCount: attempt, startedAt: Date.now() };
        await plugin.start(ctx);
        // Normal exit (signal aborted or channel decided to stop)
        runtime.status = { ...runtime.status, state: "stopped" };
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ChannelManager] ${plugin.meta.label} crashed: ${errorMsg}`);

        if (controller.signal.aborted) {
          runtime.status = { ...runtime.status, state: "stopped" };
          return;
        }

        attempt++;
        runtime.status = {
          state: "errored",
          lastError: errorMsg,
          restartCount: attempt,
          startedAt: runtime.status.startedAt,
        };

        if (attempt > MAX_RESTART_ATTEMPTS) {
          console.error(
            `[ChannelManager] ${plugin.meta.label} exceeded max restart attempts (${MAX_RESTART_ATTEMPTS}), giving up`,
          );
          return;
        }

        const delay = backoffMs(attempt - 1);
        console.log(
          `[ChannelManager] ${plugin.meta.label} restarting in ${delay / 1000}s (attempt ${attempt}/${MAX_RESTART_ATTEMPTS})`,
        );

        await sleep(delay, controller.signal);
      }
    }

    runtime.status = { ...runtime.status, state: "stopped" };
  }

  private buildContext(plugin: ChannelPlugin, signal: AbortSignal): ChannelContext {
    // resolveConfig is already called in startAll/runWithRestart — calling again here
    // is intentional to get fresh ownerId on restart. resolveConfig is cheap and idempotent.
    const config = plugin.resolveConfig(this.opts.settingsStore);
    const ownerId = typeof config?.ownerId === "string" ? config.ownerId : undefined;

    const transcript: TranscriptFn = (sessionKey, role, text) =>
      this.opts.messageStore.append(sessionKey, role, text);

    const notify = this.opts.buildNotify(ownerId);

    return {
      handler: this.opts.handler,
      transcript,
      notify,
      signal,
      services: this.opts.services,
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
