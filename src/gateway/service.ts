import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentEvent } from "klaus-agent";
import type { MediaFile } from "../message.js";
import type { CronTask } from "../types.js";
import type { Handler } from "../types.js";
import type { MessageStore } from "../message-store.js";
import type {
  McpServerRecord,
  PromptRecord,
  RuleRecord,
  SettingsStore,
} from "../settings-store.js";
import type { UserStore } from "../user-store.js";
import type { CronSchedulerStatus } from "../types.js";
import type { ModelPreset } from "../providers/types.js";
import {
  buildWebSessionKey,
  type GatewayPushClient,
  type GatewayRpcResponseEnvelope,
  type WsEvent,
} from "./protocol.js";
import {
  createGatewayAgentEventForwarder,
  processGatewayInboundMessage,
} from "./server-methods/chat.js";
import {
  completeGatewayProviderOAuth,
  dispatchGatewayCapabilityHttpRoute,
  type OAuthCallbackPage,
  type PendingOAuth,
  beginGatewayProviderOAuth,
  getGatewayAdminCapabilities,
  listGatewayAdminProviders,
  reloadGatewayAdminProviders,
} from "./server-methods/providers.js";
import {
  deleteGatewaySession,
  listGatewaySessions,
  readGatewayHistory,
} from "./server-methods/sessions.js";
import {
  createGatewayAdminMcpServer,
  createGatewayAdminModel,
  createGatewayAdminPrompt,
  createGatewayAdminRule,
  createGatewayCronTask,
  deleteGatewayAdminMcpServer,
  deleteGatewayAdminModel,
  deleteGatewayAdminPrompt,
  deleteGatewayAdminRule,
  deleteGatewayCronTask,
  getGatewayAdminSettings,
  listGatewayAdminMcpServers,
  listGatewayAdminModels,
  listGatewayAdminPrompts,
  listGatewayAdminRules,
  listGatewayAdminSessions,
  listGatewayAdminUsers,
  listGatewayCronTasks,
  readGatewayAdminHistory,
  updateGatewayAdminMcpServer,
  updateGatewayAdminModel,
  updateGatewayAdminPrompt,
  updateGatewayAdminRule,
  updateGatewayAdminSettings,
  updateGatewayAdminUser,
  updateGatewayCronTask,
  updateGatewayModelOAuthTokens,
  type CronSchedulerLike,
  type GatewaySettingsSnapshot,
} from "./server-methods/admin.js";
import {
  type GatewayAttemptSnapshot,
  GatewaySessionRuntimeRegistry,
  type GatewaySessionAttemptHistory,
  type GatewaySessionRuntimeSnapshot,
  type GatewaySessionRuntimeUpdate,
} from "./session-runtime.js";
import {
  createSessionEvent,
  type GatewaySessionEvent,
} from "./session-events.js";
import { handleGatewayRpcRequest } from "./router.js";
import { GatewayError } from "./errors.js";

type ProcessInboundMessageParams = {
  userId: string;
  sessionId: string;
  text: string;
  handler: Handler;
  media?: readonly MediaFile[];
};

type RpcRequestContext = {
  id: string;
  method: string;
  params: Record<string, unknown>;
  userId: string;
  handler: Handler;
};

class GatewayService {
  private readonly clients = new Map<string, Set<GatewayPushClient>>();
  private readonly pendingOAuth = new Map<string, PendingOAuth>();
  private readonly sessionRuntime = new GatewaySessionRuntimeRegistry();
  private messageStore: MessageStore | null = null;
  private settingsStore: SettingsStore | null = null;
  private userStore: UserStore | null = null;
  private cronScheduler: CronSchedulerLike | null = null;
  private readonly oauthCleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.oauthCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [state, entry] of this.pendingOAuth) {
        if (now - entry.createdAt > 10 * 60 * 1000) {
          this.pendingOAuth.delete(state);
        }
      }
    }, 60 * 1000);
  }

  dispose(): void {
    clearInterval(this.oauthCleanupTimer);
  }

  private publishSessionRuntime(
    runtime: GatewaySessionRuntimeSnapshot | null,
  ): void {
    if (!runtime) {
      return;
    }
    this.sendEvent(runtime.userId, {
      type: "session_runtime",
      runtime,
      sessionId: runtime.sessionId,
    });
  }

  private publishSessionRuntimeUpdate(
    update: GatewaySessionRuntimeUpdate | null,
  ): void {
    if (!update) {
      return;
    }
    this.publishSessionRuntime(update.runtime);
    if (update.lifecycle) {
      this.publishSessionEvent(
        createSessionEvent({
          kind: update.lifecycle.type,
          sessionKey: update.runtime.sessionKey,
          userId: update.runtime.userId,
          sessionId: update.runtime.sessionId,
          at: update.runtime.updatedAt,
          attemptId: update.lifecycle.attempt.attemptId,
          title:
            update.lifecycle.type === "attempt_started"
              ? "Attempt started"
              : update.lifecycle.type === "attempt_completed"
                ? "Attempt completed"
                : update.lifecycle.type === "attempt_failed"
                  ? "Attempt failed"
                  : "Attempt status changed",
          ...(update.lifecycle.type === "attempt_failed"
            ? { detail: update.lifecycle.error }
            : update.lifecycle.type === "attempt_progress"
              ? { detail: `${update.lifecycle.previousStatus} -> ${update.lifecycle.attempt.status}` }
              : {}),
          status:
            update.lifecycle.type === "attempt_failed"
              ? "error"
              : update.lifecycle.type === "attempt_completed"
                ? "success"
                : "info",
        }),
      );
      this.sendEvent(update.runtime.userId, {
        type: "session_lifecycle",
        event: update.lifecycle,
        sessionId: update.runtime.sessionId,
      });
    }
  }

  private publishSessionEvent(event: GatewaySessionEvent): void {
    this.sendEvent(event.userId, {
      type: "session_event",
      event,
      sessionId: event.sessionId,
    });
  }

  private requireMessageStore(): MessageStore {
    if (!this.messageStore) {
      throw GatewayError.unavailable("message store unavailable");
    }
    return this.messageStore;
  }

  private requireSettingsStore(): SettingsStore {
    if (!this.settingsStore) {
      throw GatewayError.unavailable("settings store unavailable");
    }
    return this.settingsStore;
  }

  private requireUserStore(): UserStore {
    if (!this.userStore) {
      throw GatewayError.unavailable("user store unavailable");
    }
    return this.userStore;
  }

  setMessageStore(store: MessageStore | null): void {
    this.messageStore = store;
  }

  setSettingsStore(store: SettingsStore | null): void {
    this.settingsStore = store;
  }

  setUserStore(store: UserStore | null): void {
    this.userStore = store;
  }

  setCronScheduler(scheduler: CronSchedulerLike | null): void {
    this.cronScheduler = scheduler;
  }

  registerClient(userId: string, client: GatewayPushClient): void {
    let clients = this.clients.get(userId);
    if (!clients) {
      clients = new Set();
      this.clients.set(userId, clients);
    }
    clients.add(client);
  }

  unregisterClient(userId: string, client: GatewayPushClient): void {
    const clients = this.clients.get(userId);
    if (!clients) {
      return;
    }
    clients.delete(client);
    if (clients.size === 0) {
      this.clients.delete(userId);
    }
  }

  hasConnectedUser(userId: string): boolean {
    return this.clients.has(userId);
  }

  connectedUserIds(): readonly string[] {
    return [...this.clients.keys()];
  }

  broadcastEvent(event: WsEvent): void {
    for (const userId of this.connectedUserIds()) {
      this.sendEvent(userId, event);
    }
  }

  sendEvent(userId: string, event: WsEvent): void {
    const clients = this.clients.get(userId);
    if (!clients) {
      return;
    }
    const data = JSON.stringify(event);
    for (const client of [...clients]) {
      try {
        client.send(data);
      } catch {
        this.unregisterClient(userId, client);
      }
    }
  }

  deliverMessage(to: string, text: string): void {
    const event: WsEvent = {
      type: "message",
      text,
      id: `cron-${Date.now().toString(36)}`,
    };

    if (to === "*") {
      for (const userId of this.connectedUserIds()) {
        this.sendEvent(userId, event);
      }
      return;
    }

    this.sendEvent(to, event);
  }

  createAgentEventForwarder(params: {
    userId: string;
    sessionId: string;
  }): (event: AgentEvent) => void {
    const sessionKey = buildWebSessionKey(params.userId, params.sessionId);
    return createGatewayAgentEventForwarder({
      userId: params.userId,
      sessionId: params.sessionId,
      sendEvent: this.sendEvent.bind(this),
      onTextChunk: () => {
        this.publishSessionRuntimeUpdate(this.sessionRuntime.recordText(sessionKey));
      },
      onThinkingChunk: () => {
        this.publishSessionRuntimeUpdate(this.sessionRuntime.recordThinking(sessionKey));
      },
      onToolStart: ({ toolName, toolCallId }) => {
        const update = this.sessionRuntime.recordToolStart(sessionKey, toolName);
        this.publishSessionRuntimeUpdate(update);
        const runtime = update?.runtime ?? this.sessionRuntime.get(sessionKey);
        if (runtime) {
          this.publishSessionEvent(
            createSessionEvent({
              kind: "tool_started",
              sessionKey,
              userId: params.userId,
              sessionId: params.sessionId,
              at: Date.now(),
              attemptId: runtime.activeAttempt?.attemptId,
              toolName,
              toolUseId: toolCallId,
              title: `Tool started: ${toolName}`,
              status: "info",
            }),
          );
        }
      },
      onToolEnd: ({ toolName, toolCallId, isError }) => {
        const update = this.sessionRuntime.recordToolEnd(sessionKey);
        this.publishSessionRuntimeUpdate(update);
        const runtime = update?.runtime ?? this.sessionRuntime.get(sessionKey);
        if (runtime) {
          this.publishSessionEvent(
            createSessionEvent({
              kind: "tool_finished",
              sessionKey,
              userId: params.userId,
              sessionId: params.sessionId,
              at: Date.now(),
              attemptId: runtime.activeAttempt?.attemptId ?? runtime.lastAttempt?.attemptId,
              toolName,
              toolUseId: toolCallId,
              title: `${isError ? "Tool failed" : "Tool finished"}: ${toolName}`,
              status: isError ? "error" : "success",
            }),
          );
        }
      },
    });
  }

  async processInboundMessage(params: ProcessInboundMessageParams): Promise<string | null> {
    return processGatewayInboundMessage({
      ...params,
      sendEvent: this.sendEvent.bind(this),
      appendTranscript: this.messageStore
        ? (sessionKey, role, text) => this.messageStore!.append(sessionKey, role, text)
        : undefined,
      onUserMessage: (sessionKey, display) =>
        this.publishSessionEvent(
          createSessionEvent({
            kind: "user_message",
            sessionKey,
            userId: params.userId,
            sessionId: params.sessionId,
            at: Date.now(),
            title: "User message",
            detail: display.slice(0, 140),
            status: "info",
          }),
        ),
      onAssistantMessage: (sessionKey, reply) => {
        const runtime = this.sessionRuntime.get(sessionKey);
        this.publishSessionEvent(
          createSessionEvent({
            kind: "assistant_message",
            sessionKey,
            userId: params.userId,
            sessionId: params.sessionId,
            at: Date.now(),
            attemptId: runtime?.activeAttempt?.attemptId ?? runtime?.lastAttempt?.attemptId,
            title: "Assistant reply",
            detail: reply.slice(0, 140),
            status: "success",
          }),
        );
      },
      onAttemptStart: (sessionKey) =>
        this.publishSessionRuntimeUpdate(
          this.sessionRuntime.startAttempt({
            sessionKey,
            userId: params.userId,
            sessionId: params.sessionId,
          }),
        ),
      onAttemptComplete: (sessionKey) =>
        this.publishSessionRuntimeUpdate(this.sessionRuntime.completeAttempt(sessionKey)),
      onAttemptError: (sessionKey, error) =>
        this.publishSessionRuntimeUpdate(
          this.sessionRuntime.failAttempt(
            sessionKey,
            error instanceof Error ? error.message : String(error),
          ),
        ),
    });
  }

  async readHistory(params: {
    userId: string;
    sessionId: string;
    limit: number;
  }): Promise<{ messages: readonly unknown[]; total: number }> {
    return readGatewayHistory({
      messageStore: this.requireMessageStore(),
      ...params,
    });
  }

  async listSessions(params: {
    userId: string;
    includeChannels?: readonly string[];
  }): Promise<{ sessions: readonly unknown[] }> {
    return listGatewaySessions({
      messageStore: this.requireMessageStore(),
      ...params,
    });
  }

  deleteSession(params: { userId: string; sessionId: string }): boolean {
    return deleteGatewaySession({
      messageStore: this.requireMessageStore(),
      ...params,
    });
  }

  listAdminModels(): { models: readonly unknown[] } {
    return listGatewayAdminModels({
      settingsStore: this.requireSettingsStore(),
    });
  }

  createAdminModel(input: Record<string, unknown>): { ok: true; model: unknown } {
    return createGatewayAdminModel({
      settingsStore: this.requireSettingsStore(),
      input,
    });
  }

  updateAdminModel(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; model: unknown } {
    return updateGatewayAdminModel({
      settingsStore: this.requireSettingsStore(),
      ...params,
    });
  }

  deleteAdminModel(id: string): boolean {
    return deleteGatewayAdminModel({
      settingsStore: this.requireSettingsStore(),
      id,
    });
  }

  updateModelOAuthTokens(params: {
    modelId: string;
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
  }): boolean {
    return updateGatewayModelOAuthTokens({
      settingsStore: this.requireSettingsStore(),
      ...params,
    });
  }

  listAdminPrompts(): { prompts: readonly PromptRecord[] } {
    return listGatewayAdminPrompts({
      settingsStore: this.requireSettingsStore(),
    });
  }

  createAdminPrompt(input: Record<string, unknown>): { ok: true; prompt: PromptRecord } {
    return createGatewayAdminPrompt({
      settingsStore: this.requireSettingsStore(),
      input,
    });
  }

  updateAdminPrompt(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; prompt: PromptRecord } {
    return updateGatewayAdminPrompt({
      settingsStore: this.requireSettingsStore(),
      ...params,
    });
  }

  deleteAdminPrompt(id: string): boolean {
    return deleteGatewayAdminPrompt({
      settingsStore: this.requireSettingsStore(),
      id,
    });
  }

  listAdminRules(): { rules: readonly RuleRecord[] } {
    return listGatewayAdminRules({
      settingsStore: this.requireSettingsStore(),
    });
  }

  createAdminRule(input: Record<string, unknown>): { ok: true; rule: RuleRecord } {
    return createGatewayAdminRule({
      settingsStore: this.requireSettingsStore(),
      input,
    });
  }

  updateAdminRule(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; rule: RuleRecord } {
    return updateGatewayAdminRule({
      settingsStore: this.requireSettingsStore(),
      ...params,
    });
  }

  deleteAdminRule(id: string): boolean {
    return deleteGatewayAdminRule({
      settingsStore: this.requireSettingsStore(),
      id,
    });
  }

  listAdminMcpServers(): { servers: readonly McpServerRecord[] } {
    return listGatewayAdminMcpServers({
      settingsStore: this.requireSettingsStore(),
    });
  }

  createAdminMcpServer(input: Record<string, unknown>): { ok: true; server: McpServerRecord } {
    return createGatewayAdminMcpServer({
      settingsStore: this.requireSettingsStore(),
      input,
    });
  }

  updateAdminMcpServer(params: {
    id: string;
    patch: Record<string, unknown>;
  }): { ok: true; server: McpServerRecord } {
    return updateGatewayAdminMcpServer({
      settingsStore: this.requireSettingsStore(),
      ...params,
    });
  }

  deleteAdminMcpServer(id: string): boolean {
    return deleteGatewayAdminMcpServer({
      settingsStore: this.requireSettingsStore(),
      id,
    });
  }

  async listAdminProviders(params?: {
    refresh?: boolean;
  }): Promise<{
    providers: readonly {
      id: string;
      label: string;
      defaultBaseUrl: string;
      models: readonly ModelPreset[];
      auth?: unknown;
    }[];
  }> {
    return listGatewayAdminProviders({
      settingsStore: this.settingsStore,
      refresh: params?.refresh,
    });
  }

  async reloadAdminProviders(): Promise<{
    ok: true;
    added: string[];
    removed: string[];
  }> {
    return reloadGatewayAdminProviders();
  }

  getAdminCapabilities(): {
    capabilities: Record<string, number>;
  } {
    return getGatewayAdminCapabilities();
  }

  beginProviderOAuth(params: {
    providerId: string;
    modelId: string;
    host?: string;
    protocol?: string;
    defaultPort: number;
  }): { redirectTo: string } {
    return beginGatewayProviderOAuth({
      pendingOAuth: this.pendingOAuth,
      ...params,
    });
  }

  async completeProviderOAuth(params: {
    code: string;
    state: string;
    error?: string | null;
  }): Promise<OAuthCallbackPage> {
    return completeGatewayProviderOAuth({
      pendingOAuth: this.pendingOAuth,
      ...params,
      updateModelOAuthTokens: this.updateModelOAuthTokens.bind(this),
    });
  }

  async dispatchCapabilityHttpRoute(params: {
    pathname: string;
    req: IncomingMessage;
    res: ServerResponse;
    isAuthenticated: boolean;
  }): Promise<boolean> {
    return dispatchGatewayCapabilityHttpRoute(params);
  }

  getSessionRuntime(params: {
    userId: string;
    sessionId: string;
  }): GatewaySessionRuntimeSnapshot | null {
    return this.sessionRuntime.get(buildWebSessionKey(params.userId, params.sessionId));
  }

  listSessionRuntimes(params?: {
    userId?: string;
  }): readonly GatewaySessionRuntimeSnapshot[] {
    return this.sessionRuntime.list(params);
  }

  getSessionAttempts(params: {
    userId: string;
    sessionId: string;
  }): readonly GatewayAttemptSnapshot[] {
    return this.sessionRuntime.getAttempts(
      buildWebSessionKey(params.userId, params.sessionId),
    );
  }

  listSessionAttemptHistories(params?: {
    userId?: string;
  }): readonly GatewaySessionAttemptHistory[] {
    return this.sessionRuntime.listAttemptHistories(params);
  }

  async listAdminUsers(): Promise<{ users: readonly unknown[] }> {
    return listGatewayAdminUsers({
      userStore: this.requireUserStore(),
      messageStore: this.messageStore,
    });
  }

  updateAdminUser(params: {
    userId: string;
    isActive?: boolean;
    role?: "admin" | "user";
  }): { user: unknown } {
    return updateGatewayAdminUser({
      userStore: this.requireUserStore(),
      ...params,
    });
  }

  async listAdminSessions(params: {
    userId: string;
  }): Promise<{ sessions: readonly unknown[] }> {
    return listGatewayAdminSessions({
      messageStore: this.requireMessageStore(),
      ...params,
    });
  }

  async readAdminHistory(params: {
    userId: string;
    sessionId: string;
  }): Promise<{ messages: readonly unknown[] }> {
    return readGatewayAdminHistory({
      messageStore: this.requireMessageStore(),
      ...params,
    });
  }

  getAdminSettings(): GatewaySettingsSnapshot {
    return getGatewayAdminSettings({
      settingsStore: this.requireSettingsStore(),
    });
  }

  updateAdminSettings(params: Record<string, unknown>): GatewaySettingsSnapshot {
    return updateGatewayAdminSettings({
      settingsStore: this.requireSettingsStore(),
      input: params,
    });
  }

  listCronTasks(): {
    tasks: readonly unknown[];
    scheduler: CronSchedulerStatus;
  } {
    return listGatewayCronTasks({
      settingsStore: this.requireSettingsStore(),
      cronScheduler: this.cronScheduler,
    });
  }

  createCronTask(input: Record<string, unknown> | CronTask): {
    ok: true;
    task: CronTask;
  } {
    return createGatewayCronTask({
      settingsStore: this.requireSettingsStore(),
      cronScheduler: this.cronScheduler,
      input,
    });
  }

  updateCronTask(params: {
    id: string;
    patch: Record<string, unknown> | Partial<CronTask>;
  }): {
    ok: true;
    task: CronTask;
  } {
    return updateGatewayCronTask({
      settingsStore: this.requireSettingsStore(),
      cronScheduler: this.cronScheduler,
      ...params,
    });
  }

  deleteCronTask(id: string): boolean {
    return deleteGatewayCronTask({
      settingsStore: this.requireSettingsStore(),
      cronScheduler: this.cronScheduler,
      id,
    });
  }

  async listAllStoredSessions(): Promise<readonly unknown[]> {
    return this.requireMessageStore().listSessions("");
  }

  deleteStoredSessionByKey(key: string): boolean {
    return this.requireMessageStore().deleteSession(key);
  }

  async runCronTask(id: string): Promise<unknown> {
    if (!this.cronScheduler) {
      throw GatewayError.unavailable("cron scheduler not available");
    }
    return this.cronScheduler.runTask(id);
  }

  getCronStatus(): CronSchedulerStatus | { running: false; taskCount: number } {
    return this.cronScheduler
      ? this.cronScheduler.getSchedulerStatus()
      : { running: false, taskCount: 0 };
  }

  async handleRpcRequest(params: RpcRequestContext): Promise<GatewayRpcResponseEnvelope> {
    return handleGatewayRpcRequest(this, params);
  }
}

const gatewayService = new GatewayService();

export function getGatewayService(): GatewayService {
  return gatewayService;
}
