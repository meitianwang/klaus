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
  type AgentToolResult,
  type Approval,
  type AssistantMessage,
  type ModelConfig,
  type ThinkingLevel,
  type MCPServerConfig,
  type MCPClient,
  type ToolExecutionContext,
} from "klaus-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { SettingsStore } from "./settings-store.js";
import { getProvider, capabilities } from "./providers/registry.js";
import { refreshAccessToken } from "./auth/oauth.js";
import type { OAuthProviderAuth } from "./auth/oauth.js";
import type { MemoryManager } from "./memory/manager.js";
import type { MemoryManagerPool } from "./memory/pool.js";
import { createMemorySearchTool, createMemoryGetTool, buildMemoryPromptSection } from "./memory/tools.js";
import { createMemorySaveTool, MEMORY_FLUSH_USER_PROMPT } from "./memory/memory-write.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import { loadSandboxConfig, sandboxExec } from "./sandbox.js";
import { createCodingTools } from "./tools/coding.js";
import { createSkillTool } from "./skills/index.js";
import { getSkillRegistry } from "./skills/registry.js";
import { extractUserId, getUserSessionsDir, getUserWorkspaceDir, ensureUserDirs } from "./user-dirs.js";

type AgentEventCallback = (event: AgentEvent) => void;

/** Auto-approve all tool calls (for direct invocation, not LLM). */
const autoApproval: Approval = {
  async request() { return true; },
  async fetchRequest() { return { id: "", toolCallId: "", sender: "", action: "", description: "" }; },
  resolve() {},
  setYolo() {},
  isYolo() { return true; },
  autoApproveActions: new Set<string>(),
  share() { return autoApproval; },
  dispose() {},
};
const refreshLocks = new Map<string, Promise<string | undefined>>();

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

interface SessionEntry {
  agent: Agent;
  loopDetector: ToolLoopDetector;
  skillVersion: number;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly store: SettingsStore;
  private readonly maxSessions: number;
  private memoryPool: MemoryManagerPool | null = null;

  constructor(store: SettingsStore) {
    this.store = store;
    this.maxSessions = store.getNumber("max_sessions", 20);
  }

  setMemoryPool(pool: MemoryManagerPool | null): void {
    this.memoryPool = pool;
  }

  async chat(
    sessionKey: string,
    text: string,
    onEvent?: AgentEventCallback,
  ): Promise<string | null> {
    // Hot-reload: evict session if skills changed (session persistence keeps history)
    const registry = getSkillRegistry();
    const existing = this.sessions.get(sessionKey);
    if (existing && registry.getVersion() > existing.skillVersion) {
      this.sessions.delete(sessionKey);
      await existing.agent.dispose();
    }

    const { agent } = await this.getOrCreate(sessionKey);

    // Track compaction events for memory flush
    let compacted = false;
    const memoryUnsub = this.memoryPool
      ? agent.subscribe((event) => { if (event.type === "compaction_end") compacted = true; })
      : undefined;

    let unsubscribe: (() => void) | undefined;
    if (onEvent) {
      unsubscribe = agent.subscribe(onEvent);
    }

    try {
      const messages = await agent.prompt(text);
      const result = extractFinalText(messages);

      // Memory flush: after compaction, run a hidden prompt to save durable memories
      // Awaited to prevent concurrent prompt() calls on the same agent
      if (compacted && this.memoryPool) {
        await this.runMemoryFlush(agent, sessionKey);
      }

      return result;
    } finally {
      unsubscribe?.();
      memoryUnsub?.();
    }
  }

  /**
   * Run a hidden memory flush turn — aligned with OpenClaw's pre-compaction memory flush.
   * Prompts the agent to save durable memories using memory_save tool.
   */
  private async runMemoryFlush(agent: Agent, sessionKey: string): Promise<void> {
    try {
      await agent.prompt(MEMORY_FLUSH_USER_PROMPT);
      console.log(`[Memory] Flush completed for ${sessionKey}`);
      // Trigger sync so new memory files are indexed
      const userId = extractUserId(sessionKey);
      const mgr = await this.memoryPool?.getOrCreate(userId);
      await mgr?.sync().catch(() => {});
    } catch (err) {
      console.warn(`[Memory] Flush prompt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Build the current tool list. Used by both getOrCreate() and invokeTool(). */
  async buildTools(userId: string, apiKeyOverride?: string): Promise<AgentTool[]> {
    const modelRecord = this.store.getDefaultModel();
    const providerDef = modelRecord?.provider ? getProvider(modelRecord.provider) : undefined;
    const apiKey = apiKeyOverride ?? modelRecord?.apiKey;

    const tools: AgentTool[] = [];
    if (providerDef?.tools && apiKey && modelRecord) {
      const baseUrl = modelRecord.baseUrl || providerDef.defaultBaseUrl;
      tools.push(...providerDef.tools(apiKey, baseUrl, modelRecord.model));
    }
    tools.push(...capabilities.buildTools());
    tools.push(...createCodingTools(getUserWorkspaceDir(userId), this.store));
    if (this.memoryPool) {
      const mgr = await this.memoryPool.getOrCreate(userId);
      tools.push(createMemorySearchTool(mgr));
      tools.push(createMemoryGetTool(mgr));
      tools.push(createMemorySaveTool(mgr.memoryDir));
    }
    return tools;
  }

  /** Invoke a registered tool directly by name (bypassing LLM). */
  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    userId: string = "admin",
  ): Promise<{ ok: true; result: AgentToolResult } | { ok: false; error: string }> {
    // "sandbox_exec" is a virtual tool — not in the registry, handled separately
    if (toolName === "sandbox_exec") {
      return this.runSandboxExec(args);
    }

    const tools = await this.buildTools(userId);
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return { ok: false, error: `Tool "${toolName}" not found. Available: ${tools.map((t) => t.name).join(", ")}` };
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 60_000);
    try {
      const ctx: ToolExecutionContext = {
        signal: ac.signal,
        onUpdate: () => {},
        approval: autoApproval,
        agentName: "klaus-direct",
      };
      const result = await tool.execute(`direct-${Date.now()}`, args, ctx);
      return { ok: true, result };
    } catch (err) {
      if (ac.signal.aborted) {
        return { ok: false, error: `Tool "${toolName}" timed out after 60s.` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Execute a command in Docker sandbox (virtual tool, not in registry). */
  private async runSandboxExec(
    args: Record<string, unknown>,
  ): Promise<{ ok: true; result: AgentToolResult } | { ok: false; error: string }> {
    const config = loadSandboxConfig(this.store);
    if (!config.enabled) {
      return { ok: false, error: "Sandbox is not enabled. Set sandbox.enabled=true in settings." };
    }
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) {
      return { ok: false, error: "Missing 'command' argument." };
    }
    try {
      const execResult = await sandboxExec(config, command, {
        stdin: typeof args.stdin === "string" ? args.stdin : undefined,
      });
      return { ok: true, result: { content: [{ type: "text", text: JSON.stringify(execResult) }] } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async reset(sessionKey: string): Promise<void> {
    const entry = this.sessions.get(sessionKey);
    if (entry) {
      if (this.memoryPool) {
        await this.runMemoryFlush(entry.agent, sessionKey);
      }
      this.sessions.delete(sessionKey);
      await entry.agent.dispose();
    }
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(entries.map((e) => e.agent.dispose()));
  }

  private async getOrCreate(sessionKey: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // LRU: move to end
      this.sessions.delete(sessionKey);
      this.sessions.set(sessionKey, existing);
      return existing;
    }

    this.evictIfNeeded();

    const userId = extractUserId(sessionKey);
    await ensureUserDirs(userId);

    // Read config from store at creation time
    const modelRecord = this.store.getDefaultModel();
    if (!modelRecord || !modelRecord.model || !modelRecord.provider) {
      throw new Error("No valid model configured. Add a model in the admin panel.");
    }

    const providerDef = getProvider(modelRecord.provider);

    // Resolve API key, refresh OAuth token if expired
    let apiKey = modelRecord.apiKey;
    if (modelRecord.authType === "oauth" && modelRecord.refreshToken && modelRecord.tokenExpiresAt) {
      const providerAuth = providerDef?.auth?.method;
      const bufferMs = 5 * 60 * 1000;
      if (providerAuth?.type === "oauth" && Date.now() > modelRecord.tokenExpiresAt - bufferMs) {
        const modelId = modelRecord.id;
        let pending = refreshLocks.get(modelId);
        if (!pending) {
          pending = (async () => {
            const result = await refreshAccessToken(providerAuth, modelRecord.refreshToken!);
            this.store.upsertModel({
              ...modelRecord,
              apiKey: result.accessToken,
              refreshToken: result.refreshToken ?? modelRecord.refreshToken,
              tokenExpiresAt: Date.now() + result.expiresIn * 1000,
            });
            return result.accessToken;
          })().finally(() => refreshLocks.delete(modelId));
          refreshLocks.set(modelId, pending);
        }
        apiKey = await pending;
      }
    }

    const model: ModelConfig = {
      provider: providerDef?.protocol ?? modelRecord.provider,
      model: modelRecord.model,
      ...(apiKey ? { apiKey } : {}),
      ...(modelRecord.baseUrl
        ? { baseUrl: modelRecord.baseUrl }
        : providerDef?.defaultBaseUrl
          ? { baseUrl: providerDef.defaultBaseUrl }
          : {}),
      maxContextTokens: modelRecord.maxContextTokens,
      ...(modelRecord.cost ? { cost: modelRecord.cost } : {}),
    };

    // Build system prompt: default prompt + enabled rules + memory section
    const promptRecord = this.store.getDefaultPrompt();
    const rules = this.store.getEnabledRules();
    const parts: string[] = [];
    if (promptRecord?.content) parts.push(promptRecord.content);
    for (const rule of rules) {
      parts.push(rule.content);
    }
    if (this.memoryPool) {
      parts.push(buildMemoryPromptSection(this.memoryPool.citationsMode));
    }
    const skillRegistry = getSkillRegistry();
    const allSkills = skillRegistry.getSkills();
    // Per-user skill filter: exclude skills the user has explicitly turned off
    const resolvedSkills = allSkills.filter((s) => {
      const pref = this.store.get(`user.${userId}.skill.${s.name}`);
      return pref !== "off";
    });
    if (resolvedSkills.length > 0) {
      const skillList = resolvedSkills
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n");
      parts.push(
        `Available skills (use invoke_skill tool to invoke):\n${skillList}`,
      );
    }
    const systemPrompt = parts.join("\n\n") || "You are a helpful assistant.";

    const yolo = this.store.getBool("yolo", true);

    // Build MCP server configs from enabled servers
    const mcpServers = this.store.getEnabledMcpServers();
    const mcpConfigs: MCPServerConfig[] = mcpServers.map((s) => ({
      name: s.name,
      transport: s.transport as MCPServerConfig["transport"],
    }));

    const tools = await this.buildTools(userId, apiKey);
    if (resolvedSkills.length > 0) {
      tools.push(createSkillTool(resolvedSkills));
    }

    const loopDetector = new ToolLoopDetector();
    const providerHooks = providerDef?.hooks;
    const agent = createAgent({
      model,
      systemPrompt,
      tools,
      approval: { yolo },
      hooks: {
        async beforeToolCall(ctx) {
          const loopResult = loopDetector.check(ctx);
          if (loopResult?.block) return loopResult;
          return providerHooks?.beforeToolCall?.(ctx);
        },
        afterToolCall: providerHooks?.afterToolCall,
      },
      thinkingLevel: (modelRecord.thinking || "off") as ThinkingLevel,
      session: {
        persist: true,
        directory: getUserSessionsDir(userId),
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

    const entry: SessionEntry = { agent, loopDetector, skillVersion: skillRegistry.getVersion() };
    this.sessions.set(sessionKey, entry);
    return entry;
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) return;

    for (const [key, entry] of this.sessions) {
      if (!entry.agent.state.isRunning) {
        this.sessions.delete(key);
        entry.agent.dispose().catch((err) => {
          console.error(`[AgentManager] Dispose failed for ${key}:`, err);
        });
        return;
      }
    }
  }
}

/** Strip XML-style tool call tags (e.g. <bash>pwd</bash>) from agent text output. */
const TOOL_TAG_NAMES = [
  "bash", "shell", "execute", "read_file", "write_file", "edit_file",
  "search", "grep", "glob", "find", "file",
  "tool_call", "function_call", "tool", "command",
].join("|");
const TOOL_BLOCK_RE = new RegExp(`<(${TOOL_TAG_NAMES})(\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, "gi");
const TOOL_OPEN_RE = new RegExp(`<\\/?(${TOOL_TAG_NAMES})(\\s[^>]*)?>`, "gi");

function stripToolTags(text: string): string {
  return text.replace(TOOL_BLOCK_RE, "").replace(TOOL_OPEN_RE, "").trim();
}

function extractFinalText(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isAssistantMessage(msg)) {
      const texts = msg.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text);
      if (texts.length > 0) {
        const raw = texts.join("\n");
        const cleaned = stripToolTags(raw);
        return cleaned || raw;
      }
    }
  }
  return null;
}

function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
  return (msg as AssistantMessage).role === "assistant";
}
