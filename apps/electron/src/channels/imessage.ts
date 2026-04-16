/**
 * iMessage channel plugin for Klaus.
 *
 * Uses the `imsg` CLI tool (macOS only) as a JSON-RPC bridge to the
 * macOS Messages app. Spawns `imsg rpc` as a child process and
 * communicates via stdin/stdout.
 *
 * Requires: macOS with Messages app, `imsg` CLI on PATH.
 * Install imsg: https://github.com/anthropics/imsg
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { singleAccountConfig, type ChannelPlugin } from "./types.js";
import { MessageDedup } from "./dedup.js";
import type { InboundMessage } from "../message.js";
import type {
  IMessageConfig,
  ImsgRpcMessage,
  ImsgInboundMessage,
} from "./imessage-types.js";

// ---------------------------------------------------------------------------
// JSON-RPC client over stdio
// ---------------------------------------------------------------------------

class ImsgRpcClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private onNotification: ((method: string, params: unknown) => void) | null = null;

  constructor(
    private cliPath: string,
    private dbPath?: string,
  ) {}

  start(onNotification: (method: string, params: unknown) => void): void {
    const args = ["rpc"];
    if (this.dbPath) args.push("--db", this.dbPath);

    this.proc = spawn(this.cliPath, args, { stdio: ["pipe", "pipe", "inherit"] });
    this.onNotification = onNotification;

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => {
      try {
        const msg: ImsgRpcMessage = JSON.parse(line);
        if (msg.id != null) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message));
            else p.resolve(msg.result);
          }
        } else if (msg.method && this.onNotification) {
          this.onNotification(msg.method, msg.params);
        }
      } catch { /* ignore malformed lines */ }
    });

    this.proc.on("exit", (code) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`imsg process exited with code ${code}`));
      }
      this.pending.clear();
      this.rl?.close();
      this.rl = null;
      this.proc = null;
    });
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new Error("imsg RPC not connected");
    }
    const id = this.nextId++;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.proc.stdin.write(request + "\n");

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  async send(to: string, text: string): Promise<void> {
    await this.call("send", { to, text, service: "iMessage" });
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("RPC client stopped"));
    }
    this.pending.clear();
  }

  get connected(): boolean {
    return this.proc != null && !this.proc.killed;
  }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let activeClient: ImsgRpcClient | undefined;

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const imessagePlugin: ChannelPlugin<IMessageConfig> = {
  meta: {
    id: "imessage",
    label: "iMessage",
    description: "macOS iMessage 桥接（需要 imsg CLI）",
    order: 7,
    icon: "imessage",
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    dm: true,
    group: true,
  },

  config: singleAccountConfig<IMessageConfig>("imessage", "cli_path", (store) => {
    const cliPath = store.get("channel.imessage.cli_path") ?? "imsg";
    // iMessage is enabled if explicitly enabled (no secret needed)
    return { cliPath, dbPath: store.get("channel.imessage.db_path") ?? undefined };
  }),

  configSchema: {
    fields: [
      { key: "cli_path", type: "string", label: "imsg CLI Path", required: false, placeholder: "imsg", help: "Leave empty to use default PATH lookup" },
    ],
    async probe(config) {
      const cliPath = config.cli_path?.trim() || "imsg";
      try {
        const { execFileSync } = await import("node:child_process");
        const output = execFileSync(cliPath, ["--version"], { timeout: 5000, encoding: "utf-8" });
        return { ok: true, meta: { version: output.trim() } };
      } catch {
        return { ok: false, error: `Cannot find imsg at "${cliPath}". Install from: https://github.com/anthropics/imsg` };
      }
    },
    deleteKeys: ["owner_id", "db_path"],
  },

  outbound: {
    deliveryMode: "direct",
    async sendText(ctx, text) {
      if (!activeClient?.connected) return { ok: false, error: "imsg not connected" };
      try {
        await activeClient.send(ctx.targetId, text);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const config = ctx.account;
      const cliPath = config.cliPath || "imsg";
      const dedup = new MessageDedup();

      console.log(`[iMessage] Starting (cli=${cliPath})`);

      const client = new ImsgRpcClient(cliPath, config.dbPath);
      activeClient = client;

      // Per-session message queue
      const sessionQueues = new Map<string, Promise<void>>();

      client.start((method, params) => {
        if (method !== "message") return;

        const msg = params as ImsgInboundMessage;
        if (!msg?.text?.trim()) return;

        const dedupeKey = `imessage:${msg.id}`;
        if (dedup.isDuplicate(dedupeKey)) return;

        const sessionKey = msg.is_group && msg.chat_id
          ? `imessage:${msg.chat_id}`
          : `imessage:${msg.sender}`;
        const senderId = msg.sender;
        const text = msg.text.trim();

        console.log(`[iMessage] Inbound: from=${senderId} group=${msg.is_group} text="${text.slice(0, 50)}"`);
        ctx.setStatus({ lastInboundAt: Date.now() });

        const inbound: InboundMessage = {
          sessionKey,
          text,
          messageType: "text",
          chatType: msg.is_group ? "group" : "private",
          senderId,
          timestamp: msg.date ? new Date(msg.date).getTime() : Date.now(),
        };

        const prev = sessionQueues.get(sessionKey) ?? Promise.resolve();
        const task = prev.then(async () => {
          try {
            await ctx.transcript(sessionKey, "user", text);
            ctx.notify(sessionKey, "user", text);

            const reply = await ctx.handler(inbound);
            if (reply) {
              await ctx.transcript(sessionKey, "assistant", reply);
              ctx.notify(sessionKey, "assistant", reply);
              ctx.setStatus({ lastOutboundAt: Date.now() });

              if (ctx.sendOutbound) {
                const targetId = msg.is_group && msg.chat_id ? msg.chat_id : msg.sender;
                await ctx.sendOutbound({
                  sessionKey,
                  chatType: msg.is_group ? "group" : "direct",
                  targetId,
                  text: reply,
                });
              } else {
                console.error("[iMessage] No outbound adapter — reply dropped");
              }
            }
          } catch (err) {
            console.error("[iMessage] Error handling message:", err);
          }
        });
        const tracked = task.catch(() => {});
        sessionQueues.set(sessionKey, tracked);
        tracked.finally(() => { if (sessionQueues.get(sessionKey) === tracked) sessionQueues.delete(sessionKey); });
      });

      ctx.setStatus({ connected: true, lastConnectedAt: Date.now(), mode: "rpc", tokenStatus: "valid" });
      console.log("[iMessage] RPC client started");

      // Block until abort signal
      return new Promise<void>((resolve) => {
        const shutdown = () => {
          console.log("[iMessage] Shutting down...");
          activeClient = undefined;
          dedup.clear();
          client.stop();
          resolve();
        };
        if (ctx.signal.aborted) { shutdown(); return; }
        ctx.signal.addEventListener("abort", shutdown, { once: true });
      });
    },

    stopAccount: async () => {
      if (activeClient) {
        activeClient.stop();
        activeClient = undefined;
      }
    },
  },
};
