/**
 * Agent session pool — manages per-session Agent instances with LRU eviction.
 * Reads model, prompt, rules, and MCP servers from SettingsStore at agent creation time.
 */

import {
  createAgent,
  registerProvider,
  type Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AssistantMessage,
  type ModelConfig,
  type ThinkingLevel,
  type MCPServerConfig,
  type MCPClient,
} from "klaus-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { SettingsStore } from "./settings-store.js";
import { getAllProviders, getProvider } from "./providers/registry.js";

for (const def of getAllProviders()) {
  if (def.factory) {
    registerProvider(def.id, def.factory);
  }
}

type AgentEventCallback = (event: AgentEvent) => void;

const SESSIONS_DIR = join(CONFIG_DIR, "agent-sessions");

/** Sanitize session key for use as filename (replace colons with underscores). */
function sanitizeSessionKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createMcpClient(config: MCPServerConfig): MCPClient {
  const t = config.transport;
  let transport: StdioClientTransport | SSEClientTransport;

  if (t.type === "stdio") {
    transport = new StdioClientTransport({
      command: t.command,
      args: t.args,
      env: t.env as Record<string, string> | undefined,
    });
  } else {
    transport = new SSEClientTransport(new URL(t.url), {
      requestInit: t.headers
        ? { headers: t.headers as Record<string, string> }
        : undefined,
    });
  }

  const client = new Client({ name: `klaus-${config.name}`, version: "1.0.0" });

  return {
    async connect() {
      await client.connect(transport);
    },
    async listTools() {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    },
    async callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      return {
        content: (result.content as { type: string; text?: string }[]) ?? [],
        isError: result.isError as boolean | undefined,
      };
    },
    async close() {
      await client.close();
    },
  };
}

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
      ...(modelRecord.cost ? { cost: modelRecord.cost } : {}),
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

    // Build MCP server configs from enabled servers
    const mcpServers = this.store.getEnabledMcpServers();
    const mcpConfigs: MCPServerConfig[] = mcpServers.map((s) => ({
      name: s.name,
      transport: s.transport as MCPServerConfig["transport"],
    }));

    // Build provider-specific tools from registry
    const tools: AgentTool[] = [];
    const providerDef = getProvider(modelRecord.provider);
    if (providerDef?.tools && modelRecord.apiKey) {
      const baseUrl = modelRecord.baseUrl || providerDef.defaultBaseUrl;
      tools.push(...providerDef.tools(modelRecord.apiKey, baseUrl, modelRecord.model));
    }

    const agent = createAgent({
      model,
      systemPrompt,
      tools,
      approval: { yolo },
      thinkingLevel: (modelRecord.thinking || "off") as ThinkingLevel,
      // Session persistence: JSONL files in ~/.klaus/agent-sessions/
      session: {
        persist: true,
        directory: SESSIONS_DIR,
        sessionId: sanitizeSessionKey(sessionKey),
      },
      // Compaction: auto-compress when context gets large
      compaction: {
        enabled: true,
        reserveTokens: Math.floor(modelRecord.maxContextTokens * 0.2),
        keepRecentTokens: Math.floor(modelRecord.maxContextTokens * 0.3),
      },
      // MCP: connect to configured servers
      ...(mcpConfigs.length > 0
        ? {
            mcp: {
              servers: mcpConfigs,
              clientFactory: createMcpClient,
            },
          }
        : {}),
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
