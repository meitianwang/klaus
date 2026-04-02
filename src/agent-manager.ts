/**
 * Agent session pool — manages per-session conversations with LRU eviction.
 * Uses the internal engine (adapted from claude-code) instead of klaus-agent SDK.
 */

import { randomUUID } from "crypto";
import { initState } from "./engine/bootstrap/state.js";
import type { SettingsStore } from "./settings-store.js";
import { getProvider, capabilities } from "./providers/registry.js";
import { refreshAccessToken } from "./auth/oauth.js";
import type { OAuthProviderAuth } from "./auth/oauth.js";
import type { MemoryManagerPool } from "./memory/pool.js";
import { createMemorySearchTool, createMemoryGetTool, buildMemoryPromptSection } from "./memory/tools.js";
import { buildSystemPrompt, ensureScratchpadDir, clearSystemPromptSections } from "./engine/constants/prompts.js";
import { createMemorySaveTool } from "./memory/memory-write.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import { loadSandboxConfig, sandboxExec } from "./sandbox.js";
import { getAllBaseTools, assembleToolPool } from "./engine/tools.js";
import { wrapLegacyTools, type LegacyAgentTool } from "./engine/utils/legacyToolAdapter.js";
import type { MCPManager } from "./mcp-manager.js";
import { getSkillRegistry } from "./skills/registry.js";
import type { SkillDefinition } from "./engine/tools/SkillTool/SkillTool.js";
import { extractUserId, ensureUserDirs } from "./user-dirs.js";

// Engine imports
import {
  query,
  type QueryParams,
  type Message,
  type AssistantMessage,
  type ToolUseContext,
  type CanUseToolFn,
  type ThinkingConfig,
  type AppState,
  type ToolPermissionContext,
  getEmptyToolPermissionContext,
} from "./engine/index.js";
import { asSystemPrompt, type SystemPrompt } from "./engine/utils/systemPromptType.js";

// ============================================================================
// Engine Event type (replaces AgentEvent from klaus-agent)
// ============================================================================

export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_start"; toolName: string; toolCallId: string; args: unknown }
  | { type: "tool_end"; toolName: string; toolCallId: string; isError: boolean }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "message_complete"; message: AssistantMessage };

type EngineEventCallback = (event: EngineEvent) => void;

const refreshLocks = new Map<string, Promise<string | undefined>>();

function sanitizeSessionKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ============================================================================
// Session Entry — replaces Agent instance
// ============================================================================

interface SessionEntry {
  messages: Message[];
  loopDetector: ToolLoopDetector;
  skillVersion: number;
  isRunning: boolean;
}

// ============================================================================
// AgentSessionManager
// ============================================================================

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly store: SettingsStore;
  private readonly maxSessions: number;
  private memoryPool: MemoryManagerPool | null = null;
  private mcpManager: MCPManager | null = null;

  constructor(store: SettingsStore) {
    this.store = store;
    this.maxSessions = store.getNumber("max_sessions", 20);
    // Initialize engine bootstrap state (cwd, sessionId) — required by tools
    initState(process.cwd());
    // Create scratchpad directory for this session
    ensureScratchpadDir();
  }

  setMemoryPool(pool: MemoryManagerPool | null): void {
    this.memoryPool = pool;
  }

  setMCPManager(mgr: MCPManager | null): void {
    this.mcpManager = mgr;
  }

  async chat(
    sessionKey: string,
    text: string,
    onEvent?: EngineEventCallback,
  ): Promise<string | null> {
    // Hot-reload: evict session if skills changed
    const registry = getSkillRegistry();
    const existing = this.sessions.get(sessionKey);
    if (existing && registry.getVersion() > existing.skillVersion) {
      this.sessions.delete(sessionKey);
    }

    const session = await this.getOrCreate(sessionKey);
    session.isRunning = true;

    try {
      // Build query params
      const { systemPrompt, userContext, apiKey, baseUrl, model, maxContextTokens, thinkingConfig, tools, toolSchemas, skillDefinitions } =
        await this.buildQueryConfig(sessionKey);

      // Inject user context as first message (matches claude-code's prependUserContext)
      if (userContext && session.messages.length === 0) {
        const contextMessage: Message = {
          type: "user",
          message: {
            role: "user",
            content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\n${userContext}\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
          },
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
          isMeta: true,
        } as Message;
        session.messages.push(contextMessage);
      }

      // Add user message
      const userMessage: Message = {
        type: "user",
        message: { role: "user", content: text },
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      } as Message;
      session.messages.push(userMessage);

      // Build ToolUseContext
      const toolUseContext = this.buildToolUseContext(session, tools, model, thinkingConfig, skillDefinitions, apiKey, baseUrl);

      // Auto-approve all tools (Klaus uses yolo mode)
      const canUseTool: CanUseToolFn = async (_tool, input) => {
        // Loop detection
        const loopResult = session.loopDetector.check({
          toolName: _tool.name,
          args: input,
          toolCallId: randomUUID(),
        });
        if (loopResult?.block) {
          return { behavior: "deny" as const, message: loopResult.reason ?? "Loop detected", decisionReason: { type: "other" as const, reason: loopResult.reason ?? "Loop detected" } };
        }
        return { behavior: "allow" as const, updatedInput: input };
      };

      const queryParams: QueryParams = {
        messages: session.messages,
        systemPrompt,
        canUseTool,
        toolUseContext,
        querySource: "repl_main_thread",
        maxOutputTokensOverride: undefined,
        maxTurns: 100,
        apiKey,
        baseURL: baseUrl,
        maxContextTokens,
        toolSchemas,
      };

      // Track compaction for memory flush via callback
      let compacted = false;
      (toolUseContext as any).onCompactProgress = (ev: { type: string }) => {
        if (ev.type === "compact_end") {
          compacted = true;
          onEvent?.({ type: "compaction_end" });
        } else {
          onEvent?.({ type: "compaction_start" });
        }
      };

      // Consume the query generator
      const gen = query(queryParams);

      for await (const event of gen) {
        if (!onEvent) continue;

        if (event.type === "assistant") {
          const msg = event as AssistantMessage;

          // Extract text/thinking deltas and tool_start from content blocks
          for (const block of msg.message.content as any[]) {
            if (block.type === "text") {
              onEvent({ type: "text_delta", text: block.text });
            } else if (block.type === "thinking") {
              onEvent({ type: "thinking_delta", thinking: block.thinking });
            } else if (block.type === "tool_use") {
              onEvent({ type: "tool_start", toolName: block.name, toolCallId: block.id, args: block.input });
            }
          }

          onEvent({ type: "message_complete", message: msg });
        } else if (event.type === "user") {
          // Tool result messages → tool_end events
          const userMsg = event as any;
          if (Array.isArray(userMsg.message?.content)) {
            for (const block of userMsg.message.content as any[]) {
              if (block.type === "tool_result") {
                onEvent({
                  type: "tool_end",
                  toolName: block.toolName ?? "",
                  toolCallId: block.tool_use_id ?? "",
                  isError: block.is_error ?? false,
                });
              }
            }
          }
        }
      }

      // Memory flush after compaction
      if (compacted && this.memoryPool) {
        await this.runMemoryFlush(session, sessionKey);
      }

      return extractFinalText(session.messages);
    } finally {
      session.isRunning = false;
    }
  }

  private async runMemoryFlush(session: SessionEntry, sessionKey: string): Promise<void> {
    // TODO: implement memory flush using engine query
    // For now, skip — will be implemented when memory tools are adapted
    console.log(`[Memory] Flush skipped for ${sessionKey} (pending engine adaptation)`);
  }

  /** Build the current tool list. */
  async buildTools(userId: string, apiKeyOverride?: string): Promise<any[]> {
    const modelRecord = this.store.getDefaultModel();
    const providerDef = modelRecord?.provider ? getProvider(modelRecord.provider) : undefined;
    const apiKey = apiKeyOverride ?? modelRecord?.apiKey;

    // Start with engine's built-in tools (BashTool, FileRead/Edit/Write, Glob, Grep, etc.)
    const tools: any[] = [...getAllBaseTools()];

    // Add capability-registered legacy tools wrapped as engine tools
    const legacyCapTools = capabilities.buildTools();
    if (legacyCapTools.length > 0) {
      tools.push(...wrapLegacyTools(legacyCapTools as LegacyAgentTool[]));
    }

    // Add memory tools wrapped as engine tools
    if (this.memoryPool) {
      const mgr = await this.memoryPool.getOrCreate(userId);
      const memTools = [
        createMemorySearchTool(mgr),
        createMemoryGetTool(mgr),
        createMemorySaveTool(mgr.memoryDir),
      ];
      tools.push(...wrapLegacyTools(memTools as LegacyAgentTool[]));
    }

    // Add MCP tools (mcp__server__tool wrappers)
    if (this.mcpManager) {
      tools.push(...this.mcpManager.mcpTools);
    }

    return tools;
  }

  /** Invoke a registered tool directly by name (bypassing LLM). */
  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    userId: string = "admin",
  ): Promise<{ ok: true; result: { content: { type: string; text: string }[] } } | { ok: false; error: string }> {
    if (toolName === "sandbox_exec") {
      return this.runSandboxExec(args);
    }

    const tools = await this.buildTools(userId);
    const tool = tools.find((t: any) => t.name === toolName);
    if (!tool) {
      return { ok: false, error: `Tool "${toolName}" not found. Available: ${tools.map((t: any) => t.name).join(", ")}` };
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 60_000);
    try {
      if (typeof tool.execute === "function") {
        // Legacy klaus-agent style tool
        const result = await tool.execute(`direct-${Date.now()}`, args, { signal: ac.signal, onUpdate: () => {}, approval: { isYolo: () => true }, agentName: "klaus-direct" });
        return { ok: true, result };
      } else if (typeof tool.call === "function") {
        // Engine-style tool
        const result = await tool.call(args, { abortController: ac } as any, async () => ({ behavior: "allow" as const, updatedInput: args }), {} as any);
        const mapped = tool.mapToolResultToToolResultBlockParam(result.data, `direct-${Date.now()}`);
        return { ok: true, result: { content: [{ type: "text", text: typeof mapped.content === "string" ? mapped.content : JSON.stringify(mapped.content) }] } };
      }
      return { ok: false, error: `Tool "${toolName}" has no execute or call method.` };
    } catch (err) {
      if (ac.signal.aborted) {
        return { ok: false, error: `Tool "${toolName}" timed out after 60s.` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runSandboxExec(
    args: Record<string, unknown>,
  ): Promise<{ ok: true; result: { content: { type: string; text: string }[] } } | { ok: false; error: string }> {
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
        await this.runMemoryFlush(entry, sessionKey);
      }
      this.sessions.delete(sessionKey);
    }
    clearSystemPromptSections();
  }

  async disposeAll(): Promise<void> {
    this.sessions.clear();
    await this.mcpManager?.close();
  }

  // ============================================================================
  // Private: session management
  // ============================================================================

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

    const entry: SessionEntry = {
      messages: [],
      loopDetector: new ToolLoopDetector(),
      skillVersion: getSkillRegistry().getVersion(),
      isRunning: false,
    };
    this.sessions.set(sessionKey, entry);
    return entry;
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) return;

    for (const [key, entry] of this.sessions) {
      if (!entry.isRunning) {
        this.sessions.delete(key);
        return;
      }
    }
  }

  // ============================================================================
  // Private: build query configuration from SettingsStore
  // ============================================================================

  private async buildQueryConfig(sessionKey: string): Promise<{
    systemPrompt: SystemPrompt;
    userContext: string | null;
    apiKey: string;
    baseUrl: string | undefined;
    model: string;
    maxContextTokens: number;
    thinkingConfig: ThinkingConfig;
    tools: any[];
    toolSchemas: any[];
    skillDefinitions: SkillDefinition[];
  }> {
    const userId = extractUserId(sessionKey);
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

    if (!apiKey) {
      throw new Error("No API key configured for the default model.");
    }

    const baseUrl = modelRecord.baseUrl || providerDef?.defaultBaseUrl;

    // Build system prompt (claude-code mechanism)
    const promptRecord = this.store.getDefaultPrompt();
    const rules = this.store.getEnabledRules();
    const skillRegistry = getSkillRegistry();
    const allSkills = skillRegistry.getSkills();
    const userPrefs = this.store.getUserSkillPreferences(userId);
    const resolvedSkills = allSkills.filter((s) => userPrefs.get(s.name) !== "off");

    // Assemble claudeMd from: default prompt + rules + memory prompt
    const claudeMdParts: string[] = [];
    if (promptRecord?.content) {
      claudeMdParts.push(`# Codebase and user instructions\n${promptRecord.content}`);
    }
    for (const rule of rules) {
      claudeMdParts.push(rule.content);
    }
    if (this.memoryPool) {
      claudeMdParts.push(buildMemoryPromptSection(this.memoryPool.citationsMode));
    }

    // Build tools
    const tools = await this.buildTools(userId, apiKey);

    // Git status snapshot (matches claude-code's getGitStatus in context.ts)
    const gitStatus = await getGitStatusSnapshot(process.cwd());

    const systemPromptParts = await buildSystemPrompt({
      model: modelRecord.model,
      cwd: process.cwd(),
      tools,
      skills: resolvedSkills.map((s) => ({ name: s.name, description: s.description })),
      mcpClients: this.mcpManager?.mcpClients,
      currentDate: new Date().toISOString().split("T")[0],
      gitStatus,
      language: this.store.getUserLanguage(userId),
      outputStyle: this.store.getUserOutputStyle(userId),
    });
    const systemPrompt = asSystemPrompt(systemPromptParts);

    // claudeMd injected as user context (matches claude-code's prependUserContext)
    const userContext = claudeMdParts.length > 0 ? claudeMdParts.join("\n\n") : null;

    // Build skill definitions for engine SkillTool
    const skillDefinitions: SkillDefinition[] = resolvedSkills.map((s) => ({
      name: s.name,
      description: s.description,
      content: s.content,
    }));

    // Thinking config
    const thinkingLevel = modelRecord.thinking || "off";
    const thinkingConfig: ThinkingConfig = thinkingLevel === "off"
      ? { type: "disabled" }
      : { type: "enabled", budgetTokens: Math.floor(modelRecord.maxContextTokens * 0.8) };

    return {
      systemPrompt,
      userContext,
      apiKey,
      baseUrl,
      model: modelRecord.model,
      maxContextTokens: modelRecord.maxContextTokens,
      thinkingConfig,
      tools,
      toolSchemas: [], // Will be built by query() if empty
      skillDefinitions,
    };
  }

  // ============================================================================
  // Private: build ToolUseContext for the engine
  // ============================================================================

  private buildToolUseContext(
    session: SessionEntry,
    tools: any[],
    model: string,
    thinkingConfig: ThinkingConfig,
    skillDefinitions: SkillDefinition[] = [],
    apiKey?: string,
    baseURL?: string,
  ): ToolUseContext {
    const appState: AppState = {
      toolPermissionContext: getEmptyToolPermissionContext(),
      skills: skillDefinitions,
    };

    return {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: model,
        tools: tools as any,
        verbose: false,
        thinkingConfig,
        mcpClients: this.mcpManager?.mcpClients ?? [],
        mcpResources: this.mcpManager?.mcpResources ?? {},
        isNonInteractiveSession: true,
        agentDefinitions: { agents: [], errors: [] },
        hooksConfig: this.store.getHooks(),
      },
      abortController: new AbortController(),
      readFileState: new Map() as any,
      getAppState: () => appState,
      setAppState: (f) => { Object.assign(appState, f(appState)); },
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: session.messages,
      // API credentials for SubAgent (AgentTool)
      apiKey,
      baseURL,
    } as ToolUseContext;
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

/**
 * Git status snapshot — matches claude-code's getGitStatus() in context.ts.
 * Returns branch, main branch, user, status, recent commits.
 */
async function getGitStatusSnapshot(cwd: string): Promise<string | null> {
  const { execSync } = await import("node:child_process");
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
  } catch {
    return null;
  }

  const run = (args: string) => {
    try {
      return execSync(`git ${args}`, { cwd, stdio: "pipe", timeout: 5000 }).toString().trim();
    } catch {
      return "";
    }
  };

  const branch = run("branch --show-current") || run("rev-parse --short HEAD");
  const mainBranch = run("config init.defaultBranch") || "main";
  const userName = run("config user.name");
  const status = run("--no-optional-locks status --short");
  const log = run("--no-optional-locks log --oneline -n 5");

  const MAX_STATUS_CHARS = 2000;
  const truncatedStatus = status.length > MAX_STATUS_CHARS
    ? status.substring(0, MAX_STATUS_CHARS) + '\n... (truncated, run "git status" for full output)'
    : status;

  return [
    "This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.",
    `Current branch: ${branch}`,
    `Main branch (you will usually use this for PRs): ${mainBranch}`,
    ...(userName ? [`Git user: ${userName}`] : []),
    `Status:\n${truncatedStatus || "(clean)"}`,
    `Recent commits:\n${log}`,
  ].join("\n\n");
}

function extractFinalText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      const texts = (assistantMsg.message.content as any[])
        .filter((b) => b.type === "text")
        .map((b) => b.text as string);
      if (texts.length > 0) {
        const raw = texts.join("\n");
        const cleaned = stripToolTags(raw);
        return cleaned || raw;
      }
    }
  }
  return null;
}
