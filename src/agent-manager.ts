/**
 * Agent session pool — manages per-session conversations with LRU eviction.
 * Uses the internal engine (adapted from claude-code) instead of klaus-agent SDK.
 */

import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { setOriginalCwd, setCwdState, setProjectRoot } from "./engine/bootstrap/state.js";
import type { SettingsStore } from "./settings-store.js";
import { getProvider, capabilities } from "./providers/registry.js";
import { refreshAccessToken } from "./auth/oauth.js";
import type { OAuthProviderAuth } from "./auth/oauth.js";
import { getSystemPrompt, getSimpleIntroSection, getSimpleSystemSection, getSimpleDoingTasksSection, getActionsSection, getSimpleToneAndStyleSection, getOutputEfficiencySection } from "./engine/constants/prompts.js";
import { clearSystemPromptSections } from "./engine/constants/systemPromptSections.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import { loadSandboxConfig, sandboxExec } from "./sandbox.js";
import { getAllBaseTools, assembleToolPool } from "./engine/tools.js";
import { wrapLegacyTools, type LegacyAgentTool } from "./engine/utils/legacyToolAdapter.js";
import type { MCPManager } from "./mcp-manager.js";
// SkillTool removed from engine — define type locally
import { extractUserId, ensureUserDirs } from "./user-dirs.js";
import { initContextCollapse, resetContextCollapse } from "./engine/services/contextCollapse/index.js";
import type { ContextCollapseStats } from "./engine/services/contextCollapse/index.js";
import { MessageQueueManager } from "./engine/services/messageQueue.js";
import type { MessageStore } from "./message-store.js";
import { createContentReplacementState } from "./engine/utils/toolResultStorage.js";
import type { ContentReplacementState } from "./engine/utils/toolResultStorage.js";

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
import { enableConfigs } from "./engine/utils/config.js";

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
  | { type: "context_collapse_stats"; collapsedSpans: number; stagedSpans: number; totalErrors: number }
  | { type: "message_complete"; message: AssistantMessage }
  | { type: "stream_mode"; mode: "requesting" | "thinking" | "responding" | "tool-input" | "tool-use" }
  | { type: "api_error"; error: string; retryAttempt?: number; maxRetries?: number }
  | { type: "requesting" }
  | { type: "tool_input_delta"; toolCallId: string; delta: string }
  | { type: "progress"; toolName: string; toolCallId: string; content: string }
  | { type: "api_retry"; attempt: number; maxRetries: number; error: string; delayMs: number }
  | { type: "tombstone"; messageUuid: string }
  | { type: "compact_boundary" }
  | { type: "done" };

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
  isRunning: boolean;
  /** Per-session message queue for the attachment pipeline. */
  messageQueue: import("./engine/services/messageQueue.js").MessageQueueManager;
  /** Per-session content replacement state for tool result budget — survives across chat turns. */
  contentReplacementState: ContentReplacementState;
}

// ============================================================================
// AgentSessionManager
// ============================================================================

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly store: SettingsStore;
  private readonly maxSessions: number;
  private mcpManager: MCPManager | null = null;
  private messageStore: MessageStore | null = null;

  constructor(store: SettingsStore) {
    this.store = store;
    this.maxSessions = store.getNumber("max_sessions", 20);
    // Initialize engine state
    const cwd = process.cwd();
    setOriginalCwd(cwd);
    setCwdState(cwd);
    setProjectRoot(cwd);
    // Enable engine config reading (must be called before any getGlobalConfig)
    enableConfigs();
    // Initialize engine bundled skills (remember, verify, simplify, etc.)
    import("./engine/skills/bundled/index.js").then(m => {
      m.initBundledSkills();
      import("./engine/skills/bundledSkills.js").then(bs => {
        console.log(`[Skills] ${bs.getBundledSkills().length} bundled skill(s) registered`);
      });
    }).catch(err => console.error("[Skills] Failed to init bundled skills:", err));
    // Seed default prompt sections from engine hardcoded content
    this.seedPromptSections();
  }

  private seedPromptSections(): void {
    const existing = new Set(this.store.listPrompts().map((p: any) => p.id));
    const defaults: { id: string; name: string; content: string }[] = [
      { id: "intro", name: "Identity & Role", content: getSimpleIntroSection(null) },
      { id: "system", name: "System Rules", content: getSimpleSystemSection() },
      { id: "doing_tasks", name: "Coding Standards", content: getSimpleDoingTasksSection() },
      { id: "actions", name: "Action Safety", content: getActionsSection() },
      { id: "tone_style", name: "Tone & Style", content: getSimpleToneAndStyleSection() },
      { id: "output_efficiency", name: "Output Efficiency", content: getOutputEfficiencySection() },
    ];
    const now = Date.now();
    for (const def of defaults) {
      if (!existing.has(def.id)) {
        this.store.upsertPrompt({
          id: def.id,
          name: def.name,
          content: def.content,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  setMessageStore(store: MessageStore | null): void {
    this.messageStore = store;
  }

  setMCPManager(mgr: MCPManager | null): void {
    this.mcpManager = mgr;
  }

  async chat(
    sessionKey: string,
    text: string,
    onEvent?: EngineEventCallback,
  ): Promise<string | null> {
    const session = await this.getOrCreate(sessionKey);
    session.isRunning = true;

    try {
      const userId = extractUserId(sessionKey);

      // Set per-user skill directory so engine scans user's skills
      const { setAdditionalDirectoriesForClaudeMd } = await import("./engine/bootstrap/state.js");
      setAdditionalDirectoriesForClaudeMd([
        join(homedir(), '.klaus', 'users', userId),
      ]);
      // Clear skill cache (user's skill directory may differ)
      const { clearCommandsCache } = await import("./engine/commands.js");
      clearCommandsCache();

      // Build query params
      const { systemPrompt, userContext, systemContext, apiKey, baseUrl, model, fallbackModel, maxContextTokens, thinkingConfig, tools, toolSchemas } =
        await this.buildQueryConfig(sessionKey);

      // Inject user context as first message (matches claude-code's prependUserContext)
      if (userContext.claudeMd && session.messages.length === 0) {
        const contextMessage: Message = {
          type: "user",
          message: {
            role: "user",
            content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\n${userContext.claudeMd}\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
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

      // Set API credentials for the engine's getAnthropicClient()
      process.env.ANTHROPIC_API_KEY = apiKey;
      if (baseUrl) {
        process.env.ANTHROPIC_BASE_URL = baseUrl;
      }

      // Build ToolUseContext
      const toolUseContext = this.buildToolUseContext(sessionKey, session, tools, model, thinkingConfig, apiKey, baseUrl);

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
        userContext,
        systemContext,
        canUseTool,
        toolUseContext,
        querySource: "repl_main_thread",
        maxOutputTokensOverride: undefined,
        maxTurns: 100,
        fallbackModel,
      } as any;

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

      // Forward context collapse stats to UI
      (toolUseContext as any).onCollapseStats = (stats: { collapsedSpans: number; stagedSpans: number; totalErrors: number }) => {
        onEvent?.({ type: "context_collapse_stats", ...stats });
      };

      // Set per-user memory path for the engine's three-layer memory system
      process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = join(homedir(), '.klaus', 'users', userId, 'memory');

      // Consume the query generator
      console.log(`[Query] Starting query with ${session.messages.length} messages, model=${model}`);
      const gen = query(queryParams);

      let currentToolCallId = ""; // Track current tool_use block ID for input_json_delta

      for await (const event of gen) {
        if (!onEvent) continue;
        const ev = event as any;

        switch (ev.type) {
          case "stream_request_start":
            onEvent({ type: "stream_mode", mode: "requesting" });
            onEvent({ type: "requesting" });
            break;

          case "stream_event": {
            // Real-time streaming events from the API (aligned with handleMessageFromStream)
            const streamEvent = ev.event;
            if (!streamEvent) break;

            switch (streamEvent.type) {
              case "message_start":
                // API response started
                break;

              case "message_stop":
                // Streaming finished, entering tool-use phase
                onEvent({ type: "stream_mode", mode: "tool-use" });
                break;

              case "content_block_start": {
                const block = streamEvent.content_block;
                if (block?.type === "thinking" || block?.type === "redacted_thinking") {
                  onEvent({ type: "stream_mode", mode: "thinking" });
                } else if (block?.type === "text") {
                  onEvent({ type: "stream_mode", mode: "responding" });
                } else if (block?.type === "tool_use") {
                  currentToolCallId = block.id;
                  onEvent({ type: "stream_mode", mode: "tool-input" });
                  onEvent({ type: "tool_start", toolName: block.name, toolCallId: block.id, args: {} });
                }
                break;
              }

              case "content_block_delta": {
                const delta = streamEvent.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  onEvent({ type: "text_delta", text: delta.text });
                } else if (delta?.type === "thinking_delta" && delta.thinking) {
                  onEvent({ type: "thinking_delta", thinking: delta.thinking });
                } else if (delta?.type === "input_json_delta" && delta.partial_json) {
                  // Tool input JSON streaming — forward to UI for live tool input display
                  // Find the current tool_use block's ID from the most recent content_block_start
                  onEvent({ type: "tool_input_delta", toolCallId: currentToolCallId, delta: delta.partial_json });
                }
                break;
              }

              case "content_block_stop":
                // Block finished, no action needed
                break;

              case "message_delta":
                // Usage updates, stop_reason — not forwarded to UI
                break;
            }
            break;
          }

          case "assistant": {
            // Complete assistant message — push to session for transcript + extractFinalText
            const msg = ev as AssistantMessage;
            session.messages.push(msg);
            onEvent({ type: "message_complete", message: msg });
            break;
          }

          case "user": {
            // Tool result messages — push to session and forward tool_end events
            session.messages.push(ev as Message);
            if (Array.isArray(ev.message?.content)) {
              for (const block of ev.message.content) {
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
            break;
          }

          case "system": {
            // System messages — compact boundary, API errors
            if (ev.subtype === "compact_boundary") {
              onEvent({ type: "compaction_end" });
              onEvent({ type: "compact_boundary" });
            } else if (ev.subtype === "api_error") {
              onEvent({ type: "api_error", error: ev.error?.message ?? "API error", retryAttempt: ev.retryAttempt, maxRetries: ev.maxRetries });
              // Also emit structured api_retry event
              onEvent({
                type: "api_retry",
                attempt: ev.retryAttempt ?? 0,
                maxRetries: ev.maxRetries ?? 0,
                error: ev.error?.message ?? "API error",
                delayMs: ev.delayMs ?? 0,
              });
            }
            break;
          }

          case "tombstone": {
            onEvent({ type: "tombstone", messageUuid: ev.messageUuid ?? ev.uuid ?? "" });
            break;
          }

          case "progress": {
            onEvent({
              type: "progress",
              toolName: ev.toolName ?? "",
              toolCallId: ev.toolCallId ?? ev.tool_use_id ?? "",
              content: ev.content ?? "",
            });
            break;
          }
        }
      }

      // Emit reliable "done" signal — the frontend uses this to unblock the UI
      onEvent?.({ type: "done" });

      console.log(`[Query] Generator finished. Messages: ${session.messages.length}`);

      return extractFinalText(session.messages);
    } finally {
      session.isRunning = false;
    }
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

    // Restore session from JSONL transcript if available.
    const messages: Message[] = [];
    if (this.messageStore) {
      try {
        const { messages: transcriptMsgs, collapseCommits, collapseSnapshot } =
          await this.messageStore.readAllEntries(sessionKey);

        // Rebuild engine Message objects from transcript
        for (const tm of transcriptMsgs) {
          messages.push({
            type: "user",
            message: { role: tm.role, content: tm.content },
            uuid: randomUUID(),
            timestamp: new Date(tm.ts).toISOString(),
            ...(tm.role === "assistant" ? { type: "assistant" as const, message: { role: "assistant" as const, content: [{ type: "text" as const, text: tm.content }], id: `msg_${randomUUID()}`, type: "message" as const, model: "<restored>", stop_reason: "end_turn" as const, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } } : {}),
          } as Message);
        }

        if (collapseCommits.length > 0) {
          console.log(
            `[Session] Found ${collapseCommits.length} collapse commit(s) for ${sessionKey} (context collapse disabled in external build)`,
          );
        }

        if (messages.length > 0) {
          console.log(
            `[Session] Restored ${messages.length} message(s) from transcript for ${sessionKey}`,
          );
        }
      } catch (error) {
        console.warn(`[Session] Failed to restore transcript for ${sessionKey}:`, error);
      }
    }

    const entry: SessionEntry = {
      messages,
      loopDetector: new ToolLoopDetector(),
      isRunning: false,
      messageQueue: new MessageQueueManager(),
      contentReplacementState: createContentReplacementState(),
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
    userContext: { [k: string]: string };
    systemContext: { [k: string]: string };
    apiKey: string;
    baseUrl: string | undefined;
    model: string;
    fallbackModel: string | undefined;
    maxContextTokens: number;
    thinkingConfig: ThinkingConfig;
    tools: any[];
    toolSchemas: any[];
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

    // Build system prompt section overrides from SettingsStore prompts table
    const sectionOverrides: Record<string, string> = {};
    for (const prompt of this.store.listPrompts()) {
      if (prompt.content && prompt.content.trim()) {
        sectionOverrides[prompt.id] = prompt.content;
      }
    }

    const rules = this.store.getEnabledRules();

    // Build tools
    const tools = await this.buildTools(userId, apiKey);

    // Git status snapshot (matches claude-code's getGitStatus in context.ts)
    const gitStatus = await getGitStatusSnapshot(process.cwd());

    const disabledSkills = this.getDisabledSkills(userId);
    const systemPromptParts = await getSystemPrompt(
      tools,
      modelRecord.model,
      undefined, // additionalWorkingDirectories
      this.mcpManager?.mcpClients,
      sectionOverrides,
      disabledSkills,
    );
    const systemPrompt = asSystemPrompt(systemPromptParts);

    // Build userContext & systemContext dicts (aligned with claude-code's context.ts)
    // Rules and memory go into userContext (not mixed into system prompt sections)
    const userContextParts: string[] = [];
    const rulesContent = rules.map(r => r.content).filter(Boolean).join("\n\n");
    if (rulesContent) {
      userContextParts.push(rulesContent);
    }
    const claudeMd = userContextParts.length > 0 ? userContextParts.join("\n\n") : null;
    const userContext: { [k: string]: string } = {
      ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${new Date().toISOString().split("T")[0]}.`,
    };
    const systemContext: { [k: string]: string } = {
      ...(gitStatus && { gitStatus }),
    };

    // Skills are now managed by the engine's own skill system (loadSkillsDir + bundledSkills)
    // No manual skillDefinitions needed — SkillTool reads from getCommands() internally

    // Thinking config
    const thinkingLevel = modelRecord.thinking || "off";
    const thinkingConfig: ThinkingConfig = thinkingLevel === "off"
      ? { type: "disabled" }
      : { type: "enabled", budgetTokens: Math.floor(modelRecord.maxContextTokens * 0.8) };

    // Pick a fallback model: first non-default model from the same provider
    const allModels = this.store.listModels();
    const fallbackRecord = allModels.find(
      (m) => m.id !== modelRecord.id && m.provider === modelRecord.provider && m.model && m.apiKey,
    );

    return {
      systemPrompt,
      userContext,
      systemContext,
      apiKey,
      baseUrl,
      model: modelRecord.model,
      fallbackModel: fallbackRecord?.model,
      maxContextTokens: modelRecord.maxContextTokens,
      thinkingConfig,
      tools,
      toolSchemas: [], // Will be built by query() if empty
    };
  }

  private getDisabledSkills(userId: string): Set<string> {
    const disabled = new Set<string>();
    const prefix = `user.${userId}.skill.`;
    const prefs = this.store.getByPrefix(prefix);
    for (const [key, value] of prefs) {
      if (value === "off") {
        disabled.add(key.slice(prefix.length)); // strip prefix to get skill name
      }
    }
    return disabled;
  }

  // ============================================================================
  // Private: build ToolUseContext for the engine
  // ============================================================================

  private buildToolUseContext(
    sessionKey: string,
    session: SessionEntry,
    tools: any[],
    model: string,
    thinkingConfig: ThinkingConfig,
    apiKey?: string,
    baseURL?: string,
  ): ToolUseContext {
    const appState = {
      toolPermissionContext: getEmptyToolPermissionContext(),
      skills: [], // Engine manages skills via getCommands() internally
      mcp: {
        tools: this.mcpManager?.mcpTools ?? [],
        clients: this.mcpManager?.mcpClients ?? [],
        commands: [],
      },
      tasks: {},
      fastMode: undefined,
      effortValue: undefined,
      advisorModel: undefined,
      settings: {},
    } as any as AppState;

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
        agentDefinitions: { agents: [], errors: [], activeAgents: [], allowedAgentTypes: undefined },
        hooksConfig: this.store.getHooks(),
      },
      abortController: new AbortController(),
      readFileState: new Map() as any,
      getAppState: () => appState,
      setAppState: (f: any) => { Object.assign(appState, f(appState)); },
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: session.messages,
      // API credentials for SubAgent (AgentTool)
      apiKey,
      baseURL,
      // Per-session message queue for the attachment pipeline
      messageQueue: session.messageQueue,
      // User ID for per-user features
      userId: extractUserId(sessionKey),
      // Per-user disabled skills (read from SettingsStore, checked by SkillTool)
      disabledSkills: this.getDisabledSkills(extractUserId(sessionKey)),
      // Per-session content replacement state for tool result budget
      contentReplacementState: session.contentReplacementState,
      // Persist collapse entries to JSONL transcript (fire-and-forget)
      persistCollapseEntry: this.messageStore
        ? (entry: any) => {
            this.messageStore!.appendEntry(sessionKey, entry as any).catch((err) => {
              console.warn('[Session] Failed to persist collapse entry:', err);
            });
          }
        : undefined,
    } as any as ToolUseContext;
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
