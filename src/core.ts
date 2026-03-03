/**
 * Claude Code SDK wrapper for multi-turn conversations.
 *
 * ClaudeChat: single session with collect mode (message queuing when busy).
 * ChatSessionManager: per-session instances with LRU eviction.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Deferred: equivalent of Python asyncio.Future
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// ClaudeChat: wraps Claude Agent SDK for multi-turn chat with collect mode
// ---------------------------------------------------------------------------

interface ChatOptions {
  systemPrompt: string;
  model?: string;
}

interface PendingMessage {
  prompt: string;
  deferred: Deferred<string | null>;
}

export class ClaudeChat {
  private sessionId: string | undefined;
  private busy = false;
  private pending: PendingMessage[] = [];
  private options: ChatOptions;
  private model: string | undefined;

  constructor(options: ChatOptions) {
    this.options = options;
    this.model = options.model;
  }

  /** Send a message to Claude and collect the full text reply. */
  private async doChat(prompt: string): Promise<string> {
    let resultText: string | undefined;
    let lastSessionId: string | undefined;

    const conversation = query({
      prompt,
      options: {
        systemPrompt: this.options.systemPrompt || undefined,
        permissionMode: "bypassPermissions",
        ...(this.model ? { model: this.model } : {}),
        ...(this.sessionId ? { resume: this.sessionId } : {}),
      },
    });

    for await (const msg of conversation) {
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = msg.result;
      }
      if ("session_id" in msg && typeof msg.session_id === "string") {
        lastSessionId = msg.session_id;
      }
    }

    if (lastSessionId) {
      this.sessionId = lastSessionId;
    }

    return resultText || "(no response)";
  }

  /**
   * Send a message, return the full text reply.
   *
   * If the agent is busy, the message is queued (collect mode).
   * Returns null for callers whose messages were merged into a batch.
   */
  async chat(prompt: string): Promise<string | null> {
    if (this.busy) {
      const deferred = createDeferred<string | null>();
      this.pending.push({ prompt, deferred });
      console.log(
        `[Collect] Queued (pending: ${this.pending.length}): ${prompt.slice(0, 80)}`,
      );
      return deferred.promise;
    }

    this.busy = true;
    try {
      let reply = await this.doChat(prompt);

      // Drain queued messages (collect mode)
      while (this.pending.length > 0) {
        const batch = [...this.pending];
        this.pending = [];

        const prompts = batch.map((b) => b.prompt);
        const merged =
          "[以下是你处理上一条消息期间用户追加发送的消息]\n" +
          prompts.join("\n");
        console.log(
          `[Collect] Merging ${batch.length} queued message(s): ${merged.slice(0, 120)}`,
        );

        // Earlier callers: their messages are merged, no separate reply
        for (const item of batch.slice(0, -1)) {
          item.deferred.resolve(null);
        }

        // Process the merged message; ensure last caller's deferred
        // is always resolved even if doChat throws.
        try {
          reply = await this.doChat(merged);
          batch[batch.length - 1].deferred.resolve(reply);
        } catch (e) {
          batch[batch.length - 1].deferred.resolve(null);
          throw e;
        }
      }

      return reply;
    } catch (err) {
      // Resolve all pending deferreds so callers don't hang forever
      for (const item of this.pending) {
        item.deferred.resolve(null);
      }
      this.pending = [];
      await this.reset();
      throw err;
    } finally {
      this.busy = false;
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  getModel(): string | undefined {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async reset(): Promise<void> {
    this.sessionId = undefined;
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

// ---------------------------------------------------------------------------
// ChatSessionManager: per-session ClaudeChat instances with LRU eviction
// ---------------------------------------------------------------------------

export class ChatSessionManager {
  static readonly MAX_SESSIONS = 20;
  private sessions = new Map<string, ClaudeChat>();
  private options: ChatOptions;

  constructor() {
    const cfg = loadConfig();
    const persona = (cfg.persona as string) ?? "";
    this.options = { systemPrompt: persona };
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.sessions.size < ChatSessionManager.MAX_SESSIONS) return;
    for (const [key, session] of this.sessions) {
      if (!session.isBusy) {
        await session.close();
        this.sessions.delete(key);
        console.log(`[Session] Evicted (LRU): ${key}`);
        return;
      }
    }
  }

  private getSession(sessionKey: string): ClaudeChat {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // Move to end (most recently used)
      this.sessions.delete(sessionKey);
      this.sessions.set(sessionKey, existing);
      return existing;
    }
    const chat = new ClaudeChat(this.options);
    this.sessions.set(sessionKey, chat);
    console.log(
      `[Session] New session: ${sessionKey} (total: ${this.sessions.size})`,
    );
    return chat;
  }

  async chat(sessionKey: string, prompt: string): Promise<string | null> {
    await this.evictIfNeeded();
    const session = this.getSession(sessionKey);
    return session.chat(prompt);
  }

  setModel(sessionKey: string, model: string): void {
    const session = this.getSession(sessionKey);
    session.setModel(model);
  }

  getModel(sessionKey: string): string | undefined {
    return this.sessions.get(sessionKey)?.getModel();
  }

  getSessionInfo(sessionKey: string): {
    active: boolean;
    busy: boolean;
    model: string | undefined;
  } {
    const session = this.sessions.get(sessionKey);
    return {
      active: !!session,
      busy: session?.isBusy ?? false,
      model: session?.getModel(),
    };
  }

  async reset(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      await session.reset();
      this.sessions.delete(sessionKey);
      console.log(`[Session] Reset: ${sessionKey}`);
    }
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close();
    }
    this.sessions.clear();
  }
}
