/**
 * Agent session pool — manages per-session conversations with LRU eviction.
 * Uses the internal engine adapted from claude-code.
 */

import { randomUUID } from "crypto";
import { homedir } from "os";
import { join, resolve, isAbsolute, relative, basename } from "path";
import { setOriginalCwd, setCwdState, setProjectRoot, runWithUserScope, setIsInteractive } from "./engine/bootstrap/state.js";
import type { SettingsStore, ArtifactOp } from "./settings-store.js";
import { getProvider } from "./providers/registry.js";
import { refreshAccessToken } from "./auth/oauth.js";
import type { OAuthProviderAuth } from "./auth/oauth.js";
import { getSystemPrompt, getSimpleIntroSection, getSimpleSystemSection, getSimpleDoingTasksSection, getActionsSection, getSimpleToneAndStyleSection, getOutputEfficiencySection } from "./engine/constants/prompts.js";
import { clearSystemPromptSections } from "./engine/constants/systemPromptSections.js";
import { ToolLoopDetector } from "./tool-loop-detector.js";
import { loadSandboxConfig, sandboxExec } from "./sandbox.js";
import { getAllBaseTools, assembleToolPool } from "./engine/tools.js";
import type { MCPServerConnection, ScopedMcpServerConfig, ServerResource } from "./engine/services/mcp/types.js";
import type { Tool } from "./engine/Tool.js";
import {
  connectToServer,
  clearServerCache,
  fetchToolsForClient,
  fetchResourcesForClient,
  getMcpToolsCommandsAndResources,
} from "./engine/services/mcp/client.js";
import { getAllMcpConfigs } from "./engine/services/mcp/config.js";
import type { Command } from "./engine/commands.js";
// SkillTool removed from engine — define type locally
import { dirname } from "path";
import { fileURLToPath } from "url";
import { extractUserId, ensureUserDirs, getUserWorkspaceDir, getUserUploadsDir } from "./user-dirs.js";
import { runWithCwdOverride } from "./engine/utils/cwd.js";
import { initContextCollapse, resetContextCollapse } from "./engine/services/contextCollapse/index.js";
import type { ContextCollapseStats } from "./engine/services/contextCollapse/index.js";
import { MessageQueueManager } from "./engine/services/messageQueue.js";
import type { MessageStore, TranscriptContentBlock } from "./message-store.js";
import { createContentReplacementState } from "./engine/utils/toolResultStorage.js";
import type { ContentReplacementState } from "./engine/utils/toolResultStorage.js";
import { parseWebSessionKey } from "./gateway/protocol.js";

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
import { createCanUseTool, type OnAskCallback } from "./engine/hooks/useCanUseTool.js";
import { loadAllPermissionRulesFromDisk } from "./engine/utils/permissions/permissionsLoader.js";
import { applyPermissionRulesToPermissionContext } from "./engine/utils/permissions/permissions.js";
import type { PermissionUpdate } from "./engine/utils/permissions/PermissionUpdateSchema.js";
import { applyPermissionUpdate } from "./engine/utils/permissions/PermissionUpdate.js";
import { addPermissionRulesToSettings } from "./engine/utils/permissions/permissionsLoader.js";
import { asSystemPrompt, type SystemPrompt } from "./engine/utils/systemPromptType.js";
import { getAutoMemPath } from "./engine/memdir/paths.js";
import { enableConfigs } from "./engine/utils/config.js";
import {
  registerLeaderToolUseConfirmQueue,
  unregisterLeaderToolUseConfirmQueue,
} from "./engine/utils/swarm/leaderPermissionBridge.js";
import { getAgentDefinitionsWithOverrides } from "./engine/tools/AgentTool/loadAgentsDir.js";
import type { AgentDefinitionsResult } from "./engine/tools/AgentTool/loadAgentsDir.js";
import {
  runWithUserCommandQueue,
  registerQueueChangeNotifier,
  unregisterQueueChangeNotifier,
} from "./engine/utils/messageQueueManager.js";
import type { QueuedCommand } from "./engine/types/textInputTypes.js";

/**
 * Sentinel text passed to chat() to trigger automatic delivery of queued
 * task-notifications without showing a user message in the conversation.
 */
export const DELIVERY_SENTINEL = '\x00deliver';

// 工具结果可能是 string，也可能是 Anthropic Messages API 的 block 数组（含
// text/image/...）。前端只展示文本，所以这里把 array 拍平成 text 拼接，image
// 用占位符标注；超过 8KB 截断，避免大输出（万行 grep）冲爆 WebSocket。
//
// CC 引擎会在某些工具结果里注入 <system-reminder> 给模型看（如 FileReadTool
// 的反恶意代码提示）。这是给模型的 in-context 安全提示，不应展示给用户 ——
// 仅在 UI 展示路径剥离掉，transcript 里原始 content 保持不变。
const TOOL_RESULT_MAX = 8 * 1024;
const SYSTEM_REMINDER_RE = /\n*<system-reminder>[\s\S]*?<\/system-reminder>\n*/g;
function stringifyToolResultContent(content: unknown): string {
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        const block = b as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        if (block.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  } else {
    text = "";
  }
  text = text.replace(SYSTEM_REMINDER_RE, "").trimEnd();
  if (text.length > TOOL_RESULT_MAX) {
    text = text.slice(0, TOOL_RESULT_MAX) + `\n…[truncated, ${text.length - TOOL_RESULT_MAX} more chars]`;
  }
  return text;
}

// ============================================================================
// Engine Event type
// ============================================================================

export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_start"; toolName: string; toolCallId: string; args: unknown }
  | { type: "tool_end"; toolName: string; toolCallId: string; isError: boolean; content: string }
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

/**
 * Walk session.messages backwards to find the tool_use that matches a
 * tool_result. Returns file_path + op when the tool is Write/Edit/NotebookEdit.
 */
function findArtifactFromToolUse(
  messages: ReadonlyArray<unknown>,
  toolUseId: string | undefined,
): { filePath: string; op: ArtifactOp } | null {
  if (!toolUseId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { type?: string; message?: { content?: unknown } };
    if (m?.type !== "assistant") continue;
    const blocks = m.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      const block = b as { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
      if (block.type !== "tool_use" || block.id !== toolUseId) continue;
      const name = block.name;
      const input = block.input ?? {};
      if (name === "Write" || name === "Edit") {
        const fp = input["file_path"];
        if (typeof fp === "string" && fp.length > 0) {
          return { filePath: fp, op: name === "Write" ? "write" : "edit" };
        }
      } else if (name === "NotebookEdit") {
        const fp = input["notebook_path"];
        if (typeof fp === "string" && fp.length > 0) {
          return { filePath: fp, op: "notebook_edit" };
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * Resolve a tool-supplied path to a relative path inside the user's
 * workspace. Returns null when the path escapes the workspace (so we
 * never record uploads-dir or system-dir paths as artifacts).
 */
function relativeWithinWorkspace(workspaceDir: string, filePath: string): string | null {
  const abs = isAbsolute(filePath) ? filePath : resolve(workspaceDir, filePath);
  const rel = relative(workspaceDir, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}

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
  /** AppState reference — used to abort in-process teammates on session cleanup. */
  appState?: AppState;
  /** Tool call count this session — used by skill nudge to decide when to trigger. */
  toolCallCount: number;
  /** Whether skill nudge has already fired for this session. */
  skillNudgeFired: boolean;
}

// ============================================================================
// AgentSessionManager
// ============================================================================

// Global state mutex removed — replaced by AsyncLocalStorage (runWithUserScope)
// which scopes additionalDirs and mcpUserConfigPath per async context,
// eliminating cross-user contamination without serialization overhead.
//
// MCP connections are now truly per-user: getServerCacheKey includes userId
// from ALS, so each user gets independent connection instances.  No reference
// counting needed — each user owns their connections outright.

interface McpUserState {
  clients: MCPServerConnection[];
  tools: Tool[];
  commands: Command[];
  resources: Record<string, ServerResource[]>;
}

function emptyMcpState(): McpUserState {
  return { clients: [], tools: [], commands: [], resources: {} };
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly store: SettingsStore;
  /** In-memory throttle for skill audit — avoids stat on every query. */
  private static readonly _lastAuditCheck = new Map<string, number>();
  private maxSessions: number;
  // Per-user MCP state — each user owns independent connections, tools, and resources.
  private readonly _mcpByUser = new Map<string, McpUserState>();
  // Per-user command queues — persist across chat() calls so background agent
  // notifications enqueued between user messages are not lost or cross-contaminated.
  private readonly _commandQueueByUser = new Map<string, QueuedCommand[]>();
  private messageStore: MessageStore | null = null;
  /** Public base URL of the Klaus server (e.g. "https://example.com").
   *  Set from config, or inferred from listen address / first request.
   *  Used for MCP OAuth callbacks. */
  private _publicBaseUrl: string | null = null;
  /** True when publicBaseUrl was explicitly set via config.yaml — prevents
   *  request-inferred URLs from overriding a deliberate user choice. */
  private _publicBaseUrlFromConfig = false;

  constructor(store: SettingsStore) {
    this.store = store;
    this.maxSessions = 20; // default; overridden async in init()
    // Initialize engine state — use ~/.klaus as project root so the engine
    // does NOT scan the Klaus source tree's .claude/skills/ (those are dev
    // tools, not user-facing skills).
    const klausHome = join(homedir(), '.klaus');
    setOriginalCwd(klausHome);
    setCwdState(klausHome);
    setProjectRoot(klausHome);
    // Klaus is interactive (WebSocket-based permission approval + task notifications).
    // Required for isForkSubagentEnabled() to return true.
    setIsInteractive(true);
    // Enable engine config reading (must be called before any getGlobalConfig)
    enableConfigs();
    // Force in-process teammate backend — Klaus is a web service, no tmux/iTerm2
    import("./engine/utils/swarm/backends/teammateModeSnapshot.js").then(m => {
      m.setCliTeammateModeOverride('in-process');
      m.captureTeammateModeSnapshot();
    });
    // Initialize engine bundled skills (remember, verify, simplify, etc.)
    import("./engine/skills/bundled/index.js").then(m => {
      m.initBundledSkills();
      import("./engine/skills/bundledSkills.js").then(bs => {
        console.log(`[Skills] ${bs.getBundledSkills().length} bundled skill(s) registered`);
      });
    }).catch(err => console.error("[Skills] Failed to init bundled skills:", err));
    // CLI hooks disabled at engine level (hasHookForEvent → false)
    // Seed default prompt sections from engine hardcoded content (fire-and-forget)
    void this.seedPromptSections();
    // Load max_sessions from store asynchronously
    void this.store.getNumber("max_sessions", 20).then((n) => { this.maxSessions = n; });
  }

  private async seedPromptSections(): Promise<void> {
    const prompts = await this.store.listPrompts();
    const existing = new Set(prompts.map((p: any) => p.id));
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
        await this.store.upsertPrompt({
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

  /**
   * Set the public base URL.
   * @param url The URL string
   * @param fromConfig True if this comes from config.yaml (locks against inference override)
   */
  setPublicBaseUrl(url: string, fromConfig = false): void {
    if (this._publicBaseUrlFromConfig && !fromConfig) return; // config takes absolute precedence
    this._publicBaseUrl = url;
    if (fromConfig) this._publicBaseUrlFromConfig = true;
  }

  get publicBaseUrl(): string | null {
    return this._publicBaseUrl;
  }

  /** Whether the publicBaseUrl was set explicitly via config.yaml. */
  get publicBaseUrlIsFromConfig(): boolean {
    return this._publicBaseUrlFromConfig;
  }

  /** Get per-user MCP state (read-only, returns empty if not initialized). */
  private getMcpState(userId: string): McpUserState {
    return this._mcpByUser.get(userId) ?? emptyMcpState();
  }

  /**
   * Initialize MCP connections for a specific user.
   * Uses AsyncLocalStorage to scope the config path — no global mutex needed.
   */
  async initMcp(userId?: string): Promise<void> {
    const { getUserMcpConfigPath } = await import("./user-dirs.js");
    const userAdditionalDirs = userId
      ? [join(homedir(), '.klaus', 'users', userId)]
      : [];
    const mcpConfigPath = userId ? getUserMcpConfigPath(userId) : null;

    await runWithUserScope(
      { userId: userId ?? undefined, additionalDirectoriesForClaudeMd: userAdditionalDirs, currentMcpUserConfigPath: mcpConfigPath },
      () => this._initMcpUnlocked(userId),
    );
  }

  /**
   * Internal: initialize MCP connections.
   * Must be called within a runWithUserScope() context so that
   * getAllMcpConfigs() reads the correct per-user config path from ALS.
   */
  private async _initMcpUnlocked(userId?: string): Promise<void> {
    const uid = userId ?? "__global__";

    const { servers } = await getAllMcpConfigs();
    if (Object.keys(servers).length === 0) {
      this._mcpByUser.set(uid, emptyMcpState());
      return;
    }

    const state = emptyMcpState();

    await getMcpToolsCommandsAndResources(
      ({ client, tools, commands, resources }) => {
        state.clients.push(client);
        state.tools.push(...tools);
        if (commands) state.commands.push(...commands);
        if (resources && resources.length > 0) {
          state.resources[client.name] = resources;
        }

        if (client.type === "connected") {
          console.log(
            `[MCP:${uid}] Connected to "${client.name}" — ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`,
          );
        } else if (client.type === "failed") {
          console.warn(`[MCP:${uid}] Failed to connect to "${client.name}"`);
        } else {
          console.log(`[MCP:${uid}] "${client.name}" state: ${client.type}`);
        }
      },
      servers,
    );

    this._mcpByUser.set(uid, state);
  }

  /** Invalidate cached MCP state for a user so next chat() triggers a reload.
   *  Closes existing connections before removing state to prevent leaks. */
  async invalidateMcpCache(userId?: string): Promise<void> {
    await this._closeMcpConnections(userId);
  }

  async reconnectMcp(userId?: string): Promise<void> {
    await this._closeMcpConnections(userId);
    await this.initMcp(userId);
  }

  /** Internal: close MCP connections for user(s) and remove per-user state.
   *  Each user owns their connections — clearServerCache with explicit userId
   *  ensures the correct per-user cache entries are cleaned up. */
  private async _closeMcpConnections(userId?: string): Promise<void> {
    const uids = userId ? [userId] : [...this._mcpByUser.keys()];
    for (const uid of uids) {
      const state = this._mcpByUser.get(uid);
      if (state) {
        for (const client of state.clients) {
          if (client.type === "connected") {
            try { await clearServerCache(client.name, client.config, uid); }
            catch (err) { console.error(`[MCP:${uid}] Error closing "${client.name}": ${err}`); }
          }
        }
      }
      this._mcpByUser.delete(uid);
    }
  }

  async chat(
    sessionKey: string,
    text: string,
    onEvent?: EngineEventCallback,
    sendEvent?: (userId: string, event: import("./gateway/protocol.js").WsEvent) => void,
    media?: readonly import("./message.js").MediaFile[],
  ): Promise<string | null> {
    const session = await this.getOrCreate(sessionKey);
    session.isRunning = true;

    try {
      const userId = extractUserId(sessionKey);

      // Per-user scoped state — AsyncLocalStorage propagates through all awaits,
      // eliminating global-state races between concurrent users.
      const userAdditionalDirs = [
        join(homedir(), '.klaus', 'users', userId),
      ];
      const userMemoryPath = join(homedir(), '.klaus', 'users', userId, 'memory');
      const { getUserMcpConfigPath } = await import("./user-dirs.js");

      // Build a partial scope (without API credentials) for pre-config operations.
      const baseScope = {
        userId,
        additionalDirectoriesForClaudeMd: userAdditionalDirs,
        currentMcpUserConfigPath: getUserMcpConfigPath(userId),
        memoryPathOverride: userMemoryPath,
        claudeConfigHomeDirOverride: join(homedir(), '.klaus', 'users', userId),
      };

      // Ensure this user's MCP servers are loaded.
      if (!this._mcpByUser.has(userId)) {
        await runWithUserScope(baseScope, () => this._initMcpUnlocked(userId));
      }

      // Build query config inside user scope.
      // No clearCommandsCache() needed — memoize keys include userId from ALS,
      // so each user gets independent cached results automatically.
      const { getAttachmentMessages } = await import("./engine/utils/attachments.js");
      const { toArray } = await import("./engine/utils/generators.js");

      // buildQueryConfig calls getSystemPrompt() which reads cwd from ALS.
      // Wrap with runWithCwdOverride so the system prompt shows the user's
      // own workspace (getUserWorkspaceDir) instead of the global ~/.klaus.
      const { systemPrompt, userContext, systemContext, apiKey, baseUrl, model, fallbackModel, maxContextTokens, thinkingConfig, tools, toolSchemas } =
        await runWithCwdOverride(getUserWorkspaceDir(userId), () => runWithUserScope(baseScope, async () => {
          return this.buildQueryConfig(sessionKey);
        }));

      // Full scope includes API credentials — used for the query loop and
      // everything that may create an Anthropic client.
      const userScope = {
        ...baseScope,
        anthropicApiKey: apiKey,
        anthropicBaseUrl: baseUrl ?? null,
      };

      // Load agent definitions via engine (built-ins + custom .claude/agents/*.md files).
      // Run inside userScope so ALS-scoped claudeConfigHomeDirOverride is active,
      // ensuring per-user agent directories are scanned correctly.
      const agentDefinitions = await runWithUserScope(userScope, () =>
        getAgentDefinitionsWithOverrides(join(homedir(), '.klaus', 'users', userId))
      );

      // Build ToolUseContext
      const toolUseContext = await this.buildToolUseContext(sessionKey, session, tools, model, thinkingConfig, agentDefinitions, apiKey, baseUrl);

      // Thread the rendered system prompt into the context so fork subagents can
      // inherit it byte-for-byte (AgentTool.ts fork path uses this for cache-identical
      // API prefixes; without it the fallback recomputes engine defaults, losing
      // Klaus's custom system prompt sections entirely).
      toolUseContext.renderedSystemPrompt = systemPrompt;

      // Store appState reference on session for cleanup
      session.appState = toolUseContext.getAppState();

      // Wrap setAppState to detect team events and forward to WebSocket
      if (sendEvent) {
        const sessionId = parseWebSessionKey(sessionKey)?.sessionId;
        const origSetAppState = toolUseContext.setAppState;
        toolUseContext.setAppState = (f: any) => {
          const prev = toolUseContext.getAppState();
          origSetAppState(f);
          const next = toolUseContext.getAppState();
          // Detect team creation
          if (!prev.teamContext && next.teamContext) {
            sendEvent(userId, { type: "team_created", teamName: next.teamContext.teamName, sessionId });
          }
          // Detect new in-process teammate tasks + progress + completion
          if (next.tasks) {
            for (const [id, task] of Object.entries(next.tasks) as [string, any][]) {
              const prevTask = prev.tasks?.[id] as any;
              if (task.type !== "in_process_teammate") continue;

              // New task spawned
              if (!prevTask) {
                sendEvent(userId, {
                  type: "teammate_spawned",
                  agentId: task.identity?.agentId ?? id,
                  name: task.identity?.agentName ?? "agent",
                  color: task.identity?.color,
                  sessionId,
                });
              }

              // Tool call progress
              if ((prevTask?.toolCallCount ?? 0) !== (task.toolCallCount ?? 0)) {
                sendEvent(userId, {
                  type: "agent_progress",
                  agentId: task.identity?.agentId ?? id,
                  agentName: task.identity?.agentName ?? "agent",
                  toolUseCount: task.toolCallCount ?? 0,
                  sessionId,
                });
              }

              // Task completed or failed
              if (prevTask && !prevTask.result && !prevTask.error && (task.result || task.error)) {
                sendEvent(userId, {
                  type: "agent_done",
                  agentId: task.identity?.agentId ?? id,
                  agentName: task.identity?.agentName ?? "agent",
                  status: task.error ? "failed" : "completed",
                  sessionId,
                });
              }
            }
          }
        };
      }

      // Prepend @-mentions for uploaded images so the engine's existing
      // processAtMentionedFiles → FileReadTool pipeline handles them natively
      // (resize, compress, inject as simulated tool_use/tool_result pairs).
      const inputText = prependImageMentions(text, media);

      const attachmentMessages: Message[] = await runWithUserScope(
        userScope,
        async () => toArray(
          getAttachmentMessages(
            inputText,
            toolUseContext as any,
            null,
            [],
            session.messages,
            "repl_main_thread" as any,
          ),
        ) as Promise<Message[]>,
      );

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

      // Add user message (or a hidden meta message for notification delivery)
      if (text === DELIVERY_SENTINEL) {
        // Notification delivery: inject an invisible trigger message so the query
        // loop drains the pending task-notification queue without leaking a
        // user-visible message into the conversation.
        const metaMessage: Message = {
          type: "user",
          message: { role: "user", content: "" },
          uuid: randomUUID(),
          isMeta: true,
          timestamp: new Date().toISOString(),
        } as Message;
        session.messages.push(metaMessage);
      } else {
        const userMessage: Message = {
          type: "user",
          message: { role: "user", content: inputText },
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
        } as Message;
        session.messages.push(userMessage);
      }

      // Inject attachment messages after user message
      for (const attachMsg of attachmentMessages) {
        session.messages.push(attachMsg);
      }

      // Permission check: delegate to engine's full permission pipeline
      // (rules, modes, safety checks, classifier) + WebSocket approval for 'ask'
      const onAsk: OnAskCallback = async ({ tool: askTool, input: askInput, message, suggestions, toolUseContext: askCtx }) => {
        // Loop detection (checked before sending to user)
        const loopResult = session.loopDetector.check({
          toolName: askTool.name,
          args: askInput,
          toolCallId: randomUUID(),
        });
        if (loopResult?.block) {
          return { decision: "deny" as const };
        }

        const parsed = parseWebSessionKey(sessionKey);
        if (!parsed || !sendEvent) {
          return { decision: "deny" as const };
        }

        const { permissionManager } = await import("./permission-manager.js");
        console.log(`[Permission] Asking user for ${askTool.name} (mode=${askCtx.getAppState().toolPermissionContext.mode})`);

        // Serialize suggestions for the WebSocket protocol
        const serializedSuggestions = suggestions?.map(s => ({ ...s } as Record<string, unknown>));

        const response = await permissionManager.requestPermission({
          userId: parsed.userId,
          sessionId: parsed.sessionId,
          toolName: askTool.name,
          toolInput: askInput,
          message,
          suggestions: serializedSuggestions,
          sendEvent,
        });

        // If user accepted suggestions (e.g. "Always Allow"), persist them
        if (response.decision === "allow" && response.acceptedSuggestionIndices && suggestions) {
          for (const idx of response.acceptedSuggestionIndices) {
            const suggestion = suggestions[idx];
            if (suggestion) {
              try {
                // Apply to in-memory context
                const appState = askCtx.getAppState();
                const updated = applyPermissionUpdate(appState.toolPermissionContext, suggestion);
                askCtx.setAppState((prev: AppState) => ({
                  ...prev,
                  toolPermissionContext: updated,
                }));
                // Persist to disk (settings.json)
                if (suggestion.type === 'addRules' && suggestion.rules && suggestion.behavior) {
                  addPermissionRulesToSettings(
                    { ruleValues: suggestion.rules, ruleBehavior: suggestion.behavior },
                    (suggestion as any).destination ?? 'userSettings',
                  );
                }
              } catch (err) {
                console.warn(`[Permission] Failed to persist suggestion:`, err);
              }
            }
          }
        }

        return {
          decision: response.decision,
          updatedInput: response.updatedInput,
        };
      };

      const canUseTool = createCanUseTool(onAsk);

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

      // Clear memoized getAutoMemPath so it picks up the ALS-scoped override
      getAutoMemPath.cache.clear?.();

      // Run the entire query loop inside user scope — ALS propagates through
      // all awaits in the for-await loop, so engine code always sees this user's
      // dirs, MCP config, API credentials, and memory path.
      // Wrap with per-user workspace cwd so BashTool, sub-agents, and in-process
      // teammates all inherit the same isolated workspace (ALS propagates through
      // all nested async calls including spawnTeammate → inProcessRunner).
      // Wrap with per-user command queue so background agent notifications are
      // never visible to other users' query turns (cross-user contamination fix).
      const userQueue = this._commandQueueByUser.get(userId) ?? [];
      this._commandQueueByUser.set(userId, userQueue);
      // Register queue change notifier — fires when a background agent enqueues
      // a task-notification, so we can push notification_ready to the browser.
      const parsed = parseWebSessionKey(sessionKey);
      if (parsed && sendEvent) {
        registerQueueChangeNotifier(userQueue, () => {
          if (!session.isRunning) {
            sendEvent(userId, { type: "notification_ready", sessionKey });
          }
        });
      }
      return await runWithUserCommandQueue(userQueue, () => runWithCwdOverride(getUserWorkspaceDir(userId), () => runWithUserScope(userScope, async () => {

      console.log(`[Query] Starting query with ${session.messages.length} messages, model=${model}`);

      // Register leader permission bridge — routes in-process teammate permission
      // requests through Klaus's WebSocket permission system.
      const parsed = parseWebSessionKey(sessionKey);
      if (parsed && sendEvent) {
        registerLeaderToolUseConfirmQueue((updater) => {
          // The updater appends a new entry to the queue. Run it on an empty
          // array to extract the new entry without needing React state.
          const entries: any[] = [];
          const result = updater(entries);
          const entry = result[result.length - 1] as any;
          if (!entry?.tool) return;

          // Route through Klaus's WebSocket permission system
          import("./permission-manager.js").then(async ({ permissionManager }) => {
            const response = await permissionManager.requestPermission({
              userId: parsed.userId,
              sessionId: parsed.sessionId,
              toolName: entry.tool.name,
              toolInput: entry.input,
              message: entry.description ?? `${entry.tool.name} (teammate: ${entry.workerBadge?.name ?? "agent"})`,
              sendEvent,
            });
            if (response.decision === "allow") {
              entry.onAllow?.(entry.input, false);
            } else {
              entry.onReject?.();
            }
          });
        });
      }

      const gen = query(queryParams);

      let currentToolCallId = ""; // Track current tool_use block ID for input_json_delta

      for await (const event of gen) {
        const ev = event as any;

        // Session state maintenance — must run even without onEvent (e.g. cron
        // executor) so extractFinalText sees the full conversation.
        switch (ev.type) {
          case "assistant": {
            const msg = ev as AssistantMessage;
            session.messages.push(msg);
            // Track skill usage from tool_use blocks in the assistant message
            if (Array.isArray(msg.message?.content)) {
              for (const block of msg.message.content) {
                if (block.type === "tool_use" && block.name === "Skill") {
                  const skillName = (block.input as any)?.skill ?? "unknown";
                  void import("./skill-tracker.js").then(({ recordSkillUsage }) => {
                    void recordSkillUsage(join(homedir(), '.klaus', 'users', userId), skillName, sessionKey);
                  });
                }
              }
            }
            break;
          }
          case "user": {
            session.messages.push(ev as Message);
            if (Array.isArray(ev.message?.content)) {
              const workspaceDir = getUserWorkspaceDir(userId);
              for (const block of ev.message.content) {
                if (block.type === "tool_result") {
                  session.toolCallCount++;
                  // Track Write/Edit/NotebookEdit artifacts on success.
                  if (block.is_error) continue;
                  const found = findArtifactFromToolUse(
                    session.messages,
                    block.tool_use_id,
                  );
                  if (!found) continue;
                  const rel = relativeWithinWorkspace(workspaceDir, found.filePath);
                  if (!rel) continue;
                  void (async () => {
                    try {
                      const rec = await this.store.upsertArtifactForUser(sessionKey, userId, rel, found.op);
                      if (parsed && sendEvent) {
                        sendEvent(parsed.userId, {
                          type: "artifact",
                          sessionId: parsed.sessionId,
                          filePath: rec.filePath,
                          fileName: basename(rec.filePath),
                          lastOp: rec.lastOp,
                          firstSeenAt: rec.firstSeenAt,
                          lastModifiedAt: rec.lastModifiedAt,
                        });
                      }
                    } catch (err) {
                      console.error("[Artifact] upsert failed:", err);
                    }
                  })();
                }
              }
            }
            break;
          }
        }

        // UI event forwarding — skip entirely when no callback (cron, headless)
        if (!onEvent) continue;

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
            // UI notification — session.messages.push already done above
            onEvent({ type: "message_complete", message: ev as AssistantMessage });
            break;
          }

          case "user": {
            // Forward tool_end events to UI
            if (Array.isArray(ev.message?.content)) {
              for (const block of ev.message.content) {
                if (block.type === "tool_result") {
                  const toolName = block.toolName ?? "";
                  onEvent({
                    type: "tool_end",
                    toolName,
                    toolCallId: block.tool_use_id ?? "",
                    isError: block.is_error ?? false,
                    content: stringifyToolResultContent(block.content),
                  });

                  // Auto-push MCP OAuth auth URL to the user's browser so it
                  // opens automatically — no manual copy-paste needed.
                  if (
                    sendEvent &&
                    block.toolName?.endsWith("__authenticate") &&
                    typeof block.content === "string"
                  ) {
                    const urlMatch = block.content.match(/https?:\/\/\S+/);
                    if (urlMatch) {
                      const serverName = block.toolName.replace(/^mcp__/, "").replace(/__authenticate$/, "");
                      sendEvent(userId, {
                        type: "mcp_auth_url",
                        serverName,
                        url: urlMatch[0],
                        sessionId: parseWebSessionKey(sessionKey)?.sessionId,
                      });
                    }
                  }
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

      // --- Self-evolution hooks (fire-and-forget) ---
      // Skill Nudge: auto-create skills after complex sessions (once per session)
      if (session.toolCallCount >= 10 && !session.skillNudgeFired) {
        session.skillNudgeFired = true;
        void import("./skill-nudge.js").then(({ runSkillNudge }) => {
          void runSkillNudge(userId, join(homedir(), '.klaus', 'users', userId));
        });
      }
      // Skill Audit: periodic cleanup of unused skills (throttled to once per hour in-memory)
      if (!AgentSessionManager._lastAuditCheck.has(userId) ||
          Date.now() - AgentSessionManager._lastAuditCheck.get(userId)! > 3_600_000) {
        AgentSessionManager._lastAuditCheck.set(userId, Date.now());
        void import("./skill-audit.js").then(({ maybeRunSkillAudit }) => {
          void maybeRunSkillAudit(userId, join(homedir(), '.klaus', 'users', userId));
        });
      }

      console.log(`[Query] Generator finished. Messages: ${session.messages.length}, toolCalls: ${session.toolCallCount}`);

      return extractFinalText(session.messages);

      }))); // end runWithUserScope + runWithCwdOverride + runWithUserCommandQueue
    } finally {
      unregisterLeaderToolUseConfirmQueue();
      // Unregister per-user queue notifier so stale callbacks don't accumulate
      const uq = this._commandQueueByUser.get(extractUserId(sessionKey));
      if (uq) unregisterQueueChangeNotifier(uq);
      session.isRunning = false;
    }
  }

  /** Build the current tool list. */
  async buildTools(userId: string, apiKeyOverride?: string): Promise<any[]> {
    const workspaceDir = getUserWorkspaceDir(userId);
    const uploadsDir   = getUserUploadsDir(userId);
    const allowedDirs  = [workspaceDir, uploadsDir];
    const modelRecord = await this.store.getDefaultModel();
    const providerDef = modelRecord?.provider ? getProvider(modelRecord.provider) : undefined;
    const apiKey = apiKeyOverride ?? modelRecord?.apiKey;

    // Engine built-in tools (BashTool, FileRead/Edit/Write, Glob, Grep, etc.)
    // Exclude ListMcpResourcesTool/ReadMcpResourceTool — they are in getAllBaseTools()
    // for enumeration only; the MCP client adds them per-server when resources are
    // supported (same as original getTools() filtering in tools.ts:175-181).
    const MCP_RESOURCE_TOOLS = new Set(["ListMcpResourcesTool", "ReadMcpResourceTool"]);
    const tools: any[] = [...getAllBaseTools()]
      .filter(t => t.isEnabled() && !MCP_RESOURCE_TOOLS.has(t.name))
      .map(t => sandboxGuard(t, workspaceDir, allowedDirs));

    // MCP tools (mcp__server__tool wrappers) — per-user
    const mcpState = this._mcpByUser.get(userId);
    if (mcpState && mcpState.tools.length > 0) {
      tools.push(...mcpState.tools);
    }

    // Self-evolution tools
    const { SessionSearchTool } = await import("./tools/session-search.js");
    tools.push(SessionSearchTool);

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
      if (typeof tool.call !== "function") {
        return { ok: false, error: `Tool "${toolName}" has no call method.` };
      }
      const result = await tool.call(args, { abortController: ac } as any, async () => ({ behavior: "allow" as const, updatedInput: args }), {} as any);
      const mapped = tool.mapToolResultToToolResultBlockParam(result.data, `direct-${Date.now()}`);
      return { ok: true, result: { content: [{ type: "text", text: typeof mapped.content === "string" ? mapped.content : JSON.stringify(mapped.content) }] } };
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
    const config = await loadSandboxConfig(this.store);
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
      this.abortTeammates(entry);
      this.sessions.delete(sessionKey);
    }
    clearSystemPromptSections();
  }

  async disposeAll(): Promise<void> {
    for (const entry of this.sessions.values()) {
      this.abortTeammates(entry);
    }
    this.sessions.clear();
    // Shutdown path — no new requests expected, skip mutex to avoid deadlock
    // if a chat() call is still holding the lock during SIGTERM.
    await this._closeMcpConnections();
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

        // Rebuild engine Message objects from transcript. Content on disk
        // may be either a plain string (legacy / user turns) or a
        // TranscriptContentBlock[] (thinking / tool / text). For engine
        // context restoration we only need the rendered text — thinking is
        // regenerated fresh per turn, tool records use Klaus-specific display
        // fields that don't map 1:1 to engine tool_use/tool_result blocks.
        // So flatten to text for the engine; the browser meanwhile reads
        // original blocks via readHistory and renders thinking/tool UI from
        // them on Cmd+R restore (appendMsg in web-ui-messages-js.ts).
        for (const tm of transcriptMsgs) {
          const flatText = typeof tm.content === "string"
            ? tm.content
            : (tm.content as readonly TranscriptContentBlock[])
                .filter((b): b is { readonly type: "text"; readonly text: string } => b.type === "text")
                .map(b => b.text)
                .join("");
          messages.push({
            type: "user",
            message: { role: tm.role, content: flatText },
            uuid: randomUUID(),
            timestamp: new Date(tm.ts).toISOString(),
            ...(tm.role === "assistant" ? { type: "assistant" as const, message: { role: "assistant" as const, content: [{ type: "text" as const, text: flatText }], id: `msg_${randomUUID()}`, type: "message" as const, model: "<restored>", stop_reason: "end_turn" as const, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } } : {}),
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
      toolCallCount: 0,
      skillNudgeFired: false,
    };
    this.sessions.set(sessionKey, entry);
    return entry;
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) return;

    for (const [key, entry] of this.sessions) {
      if (!entry.isRunning) {
        this.abortTeammates(entry);
        this.sessions.delete(key);
        return;
      }
    }
  }

  /** Abort all in-process teammate tasks for a session. */
  private abortTeammates(entry: SessionEntry): void {
    if (!entry.appState?.tasks) return;
    for (const task of Object.values(entry.appState.tasks) as any[]) {
      if (task.type === "in_process_teammate" && task.abortController) {
        task.abortController.abort();
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
    const modelRecord = await this.store.getDefaultModel();
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
    for (const prompt of await this.store.listPrompts()) {
      if (prompt.content && prompt.content.trim()) {
        sectionOverrides[prompt.id] = prompt.content;
      }
    }

    // Build tools
    const tools = await this.buildTools(userId, apiKey);

    const disabledSkills = await this.getDisabledSkills(userId);
    const systemPromptParts = await getSystemPrompt(
      tools,
      modelRecord.model,
      undefined, // additionalWorkingDirectories
      this.getMcpState(userId).clients,
      sectionOverrides,
      disabledSkills,
    );
    const systemPrompt = asSystemPrompt(systemPromptParts);

    // Build userContext & systemContext dicts (aligned with claude-code's context.ts)
    const userContext: { [k: string]: string } = {
      currentDate: `Today's date is ${new Date().toISOString().split("T")[0]}.`,
    };
    const systemContext: { [k: string]: string } = {};

    // Skills are now managed by the engine's own skill system (loadSkillsDir + bundledSkills)
    // No manual skillDefinitions needed — SkillTool reads from getCommands() internally

    // Thinking config
    const thinkingLevel = modelRecord.thinking || "off";
    const thinkingConfig: ThinkingConfig = thinkingLevel === "off"
      ? { type: "disabled" }
      : { type: "enabled", budgetTokens: Math.floor(modelRecord.maxContextTokens * 0.8) };

    // Pick a fallback model: first non-default model from the same provider
    const allModels = await this.store.listModels();
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

  private async getDisabledSkills(userId: string): Promise<Set<string>> {
    const disabled = new Set<string>();
    const prefix = `user.${userId}.skill.`;
    const prefs = await this.store.getByPrefix(prefix);
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

  // Klaus only populates the ToolUseContext fields it actually uses.
  // The engine type has many more fields for CLI/UI concerns that are
  // irrelevant in a headless server context.  Partial<> + cast documents
  // this intentional subset rather than hiding it behind `as any`.
  private async buildToolUseContext(
    sessionKey: string,
    session: SessionEntry,
    tools: any[],
    model: string,
    thinkingConfig: ThinkingConfig,
    agentDefinitions: AgentDefinitionsResult,
    apiKey?: string,
    baseURL?: string,
  ): Promise<ToolUseContext> {
    // Per-user permission mode takes precedence over global setting
    const userId = extractUserId(sessionKey);
    const userPermMode = await this.store.getUserPermissionMode(userId);
    const globalPermMode = await this.store.get("permission_mode");
    const permissionMode = (
      userPermMode ?? globalPermMode ?? "default"
    ) as ToolPermissionContext["mode"];
    const isBypass = permissionMode === "bypassPermissions";

    // Load permission rules from disk (settings.json files) and populate the context
    let toolPermissionCtx: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: permissionMode,
      isBypassPermissionsModeAvailable: true,
      shouldAvoidPermissionPrompts: false, // Klaus is interactive via WebSocket
    };
    try {
      const rules = loadAllPermissionRulesFromDisk();
      if (rules.length > 0) {
        toolPermissionCtx = applyPermissionRulesToPermissionContext(toolPermissionCtx, rules);
        console.log(`[Permission] Loaded ${rules.length} rule(s) from disk`);
      }
    } catch (err) {
      console.warn('[Permission] Failed to load rules from disk:', err);
    }

    const appState = {
      toolPermissionContext: toolPermissionCtx,
      skills: [], // Engine manages skills via getCommands() internally
      mcp: {
        tools: this.getMcpState(userId).tools,
        clients: this.getMcpState(userId).clients,
        commands: this.getMcpState(userId).commands,
        resources: this.getMcpState(userId).resources,
        pluginReconnectKey: 0,
      },
      tasks: {},
      fastMode: undefined,
      effortValue: undefined,
      advisorModel: undefined,
      settings: {},
    } as Partial<AppState> as AppState;

    return {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: model,
        tools: tools as any,
        verbose: false,
        thinkingConfig,
        mcpClients: this.getMcpState(userId).clients,
        mcpResources: this.getMcpState(userId).resources,
        isNonInteractiveSession: isBypass, // interactive when permissions are enabled (WebSocket approval)
        agentDefinitions,
        // Hooks disabled: Klaus uses WebSocket-based permission approval
        // instead of claude-code's CLI hooks. PreToolUse hooks block tool
        // execution with stopReason=undefined in this context.
        hooksConfig: {},
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
      disabledSkills: await this.getDisabledSkills(userId),
      // Per-session content replacement state for tool result budget
      contentReplacementState: session.contentReplacementState,
      // Public base URL for MCP OAuth callbacks (e.g. "https://example.com")
      publicBaseUrl: this._publicBaseUrl,
      // Persist collapse entries to JSONL transcript (fire-and-forget)
      persistCollapseEntry: this.messageStore
        ? (entry: any) => {
            this.messageStore!.appendEntry(sessionKey, entry as any).catch((err) => {
              console.warn('[Session] Failed to persist collapse entry:', err);
            });
          }
        : undefined,
    } as Partial<ToolUseContext> as ToolUseContext;
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

// ---------------------------------------------------------------------------
// Sandbox path guards — restrict file tools and bash to user workspace.
// ---------------------------------------------------------------------------

// Tool name → path argument key for file-system tools
const FILE_PATH_ARG_KEYS: Record<string, string> = {
  Read:  "file_path",
  Write: "file_path",
  Edit:  "file_path",
  Glob:  "path",
  Grep:  "path",
};

// Absolute path prefixes that are safe to reference in bash commands
// (system binaries, temp dirs, macOS frameworks — not user data).
const BASH_SAFE_PATH_PREFIXES = [
  "/usr/", "/bin/", "/sbin/", "/lib/", "/opt/",
  "/tmp/", "/dev/",
  "/System/", "/Library/", "/Applications/", // macOS
  "/proc/", "/sys/",                          // Linux
];

function isSandboxPath(absPath: string, allowedDirs: string[]): boolean {
  const p = resolve(absPath);
  return allowedDirs.some(dir => {
    const d = resolve(dir);
    return p === d || p.startsWith(d + "/");
  });
}

function isBashSafePath(p: string): boolean {
  return BASH_SAFE_PATH_PREFIXES.some(prefix => p.startsWith(prefix));
}

// Extract absolute path tokens from a bash command string.
// Handles both /absolute/path and ~/tilde/path forms.
function extractAbsolutePaths(command: string, home: string): string[] {
  const paths: string[] = [];
  const SEP = /(?:^|[\s'"`|&;<>()])/;

  // Match /foo/bar style absolute paths
  const absRe = /(?:^|[\s'"`|&;<>()])(\/([\w.\-_][^\s'"`|&;<>()]*)?)/g;
  let m: RegExpExecArray | null;
  while ((m = absRe.exec(command)) !== null) {
    paths.push(m[1]);
  }

  // Match ~/foo style tilde paths and resolve to absolute using real HOME
  const tildeRe = /(?:^|[\s'"`|&;<>(]])(~(?:\/[^\s'"`|&;<>()]*)?)/g;
  while ((m = tildeRe.exec(command)) !== null) {
    const tildePath = m[1];
    const resolved = tildePath === "~" ? home : tildePath.replace(/^~/, home);
    paths.push(resolved);
  }

  return paths;
}

/**
 * Wrap a tool with sandbox path enforcement:
 *   - File tools: reject path arguments outside the user's allowed dirs
 *   - Bash tool:  reject commands that reference absolute paths outside allowed dirs
 *     (excluding safe system paths like /usr, /bin, /tmp, etc.)
 * Returns the original tool unchanged for tools with no path concerns.
 */
function sandboxGuard(tool: any, cwd: string, allowedDirs: string[]): any {
  const pathKey = FILE_PATH_ARG_KEYS[tool.name];

  if (pathKey) {
    return new Proxy(tool, {
      get(target: any, prop: string | symbol, receiver: any) {
        if (prop !== "call") return Reflect.get(target, prop, receiver);
        return async (args: any, ctx: any, cb: any, appState: any) => {
          const val = args?.[pathKey];
          if (typeof val === "string" && val) {
            const abs = isAbsolute(val) ? val : resolve(cwd, val);
            if (!isSandboxPath(abs, allowedDirs)) {
              return {
                content: `<tool_use_error>Access denied: "${val}" is outside your workspace. Only ~/workspace and ~/uploads are accessible.</tool_use_error>`,
                is_error: true,
              };
            }
          }
          return target.call(args, ctx, cb, appState);
        };
      },
    });
  }

  if (tool.name === "Bash") {
    return new Proxy(tool, {
      get(target: any, prop: string | symbol, receiver: any) {
        if (prop !== "call") return Reflect.get(target, prop, receiver);
        return async (args: any, ctx: any, cb: any, appState: any) => {
          const command = typeof args?.command === "string" ? args.command : "";
          const paths = extractAbsolutePaths(command, homedir());
          const blocked = paths.filter(
            p => !isSandboxPath(p, allowedDirs) && !isBashSafePath(p),
          );
          if (blocked.length > 0) {
            return {
              content: `<tool_use_error>Access denied: command references path(s) outside your workspace: ${blocked.join(", ")}. Only ~/workspace and ~/uploads are accessible.</tool_use_error>`,
              is_error: true,
            };
          }
          return target.call(args, ctx, cb, appState);
        };
      },
    });
  }

  return tool;
}

// ---------------------------------------------------------------------------
// Image support — prepend @-mentions for uploaded images so the engine's
// processAtMentionedFiles → FileReadTool pipeline handles them natively.
// ---------------------------------------------------------------------------

function prependImageMentions(
  text: string,
  media?: readonly import("./message.js").MediaFile[],
): string {
  const images = media?.filter((m) => m.type === "image" && m.path);
  if (!images || images.length === 0) return text;

  const mentions = images.map((img) => `@${img.path}`).join(" ");
  return text ? `${mentions} ${text}` : mentions;
}
