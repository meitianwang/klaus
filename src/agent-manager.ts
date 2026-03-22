/**
 * Agent session pool — manages per-session Agent instances with LRU eviction.
 * Reads model, prompt, and rules from SettingsStore at agent creation time.
 */

import {
  createAgent,
  type Agent,
  type AgentEvent,
  type AgentMessage,
  type AssistantMessage,
  type ModelConfig,
  type ThinkingLevel,
} from "klaus-agent";
import type { SettingsStore } from "./settings-store.js";

export type AgentEventCallback = (event: AgentEvent) => void;

export class AgentSessionManager {
  private readonly agents = new Map<string, Agent>();
  private readonly store: SettingsStore;
  private readonly maxSessions: number;

  constructor(store: SettingsStore) {
    this.store = store;
    this.maxSessions = store.getNumber("max_sessions", 20);
  }

  async chat(
    sessionKey: string,
    text: string,
    onEvent?: AgentEventCallback,
  ): Promise<string | null> {
    const agent = this.getOrCreate(sessionKey);

    let unsubscribe: (() => void) | undefined;
    if (onEvent) {
      unsubscribe = agent.subscribe(onEvent);
    }

    try {
      const messages = await agent.prompt(text);
      return extractFinalText(messages);
    } finally {
      unsubscribe?.();
    }
  }

  async reset(sessionKey: string): Promise<void> {
    const agent = this.agents.get(sessionKey);
    if (agent) {
      this.agents.delete(sessionKey);
      await agent.dispose();
    }
  }

  async disposeAll(): Promise<void> {
    const agents = [...this.agents.values()];
    this.agents.clear();
    await Promise.allSettled(agents.map((a) => a.dispose()));
  }

  private getOrCreate(sessionKey: string): Agent {
    const existing = this.agents.get(sessionKey);
    if (existing) {
      this.agents.delete(sessionKey);
      this.agents.set(sessionKey, existing);
      return existing;
    }

    this.evictIfNeeded();

    // Read config from store at creation time
    const modelRecord = this.store.getDefaultModel();
    if (!modelRecord || !modelRecord.model || !modelRecord.provider) {
      throw new Error("No valid model configured. Add a model in the admin panel.");
    }

    const model: ModelConfig = {
      provider: modelRecord.provider,
      model: modelRecord.model,
      ...(modelRecord.apiKey ? { apiKey: modelRecord.apiKey } : {}),
      ...(modelRecord.baseUrl ? { baseUrl: modelRecord.baseUrl } : {}),
      maxContextTokens: modelRecord.maxContextTokens,
    };

    // Build system prompt: default prompt + enabled rules
    const promptRecord = this.store.getDefaultPrompt();
    const rules = this.store.getEnabledRules();
    const parts: string[] = [];
    if (promptRecord?.content) parts.push(promptRecord.content);
    for (const rule of rules) {
      parts.push(rule.content);
    }
    const systemPrompt = parts.join("\n\n") || "You are a helpful assistant.";

    const yolo = this.store.getBool("yolo", true);

    const agent = createAgent({
      model,
      systemPrompt,
      tools: [],
      approval: { yolo },
      thinkingLevel: (modelRecord.thinking || "off") as ThinkingLevel,
    });

    this.agents.set(sessionKey, agent);
    return agent;
  }

  private evictIfNeeded(): void {
    if (this.agents.size < this.maxSessions) return;

    for (const [key, agent] of this.agents) {
      if (!agent.state.isRunning) {
        this.agents.delete(key);
        agent.dispose().catch((err) => {
          console.error(`[AgentManager] Dispose failed for ${key}:`, err);
        });
        return;
      }
    }
  }
}

function extractFinalText(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isAssistantMessage(msg)) {
      const texts = msg.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text);
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return null;
}

function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
  return (msg as AssistantMessage).role === "assistant";
}
