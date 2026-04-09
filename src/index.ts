import { webPlugin } from "./channels/web.js";
import { feishuPlugin } from "./channels/feishu.js";
import { dingtalkPlugin } from "./channels/dingtalk.js";
import { wechatPlugin } from "./channels/wechat.js";
import { qqPlugin } from "./channels/qq.js";
import { wecomPlugin } from "./channels/wecom.js";
import { telegramPlugin } from "./channels/telegram.js";
import { imessagePlugin } from "./channels/imessage.js";
import { whatsappPlugin } from "./channels/whatsapp.js";
import { ChannelManager } from "./channels/manager.js";
import {
  getChannelNames,
  loadWebConfig,
  CONFIG_DIR,
} from "./config.js";
import { join } from "node:path";
import { attachAnalyticsSink } from "./engine/services/analytics/index.js";
import { SQLiteAnalyticsSink } from "./engine/services/analytics/sink.js";
import { t } from "./i18n.js";
import type { InboundMessage } from "./message.js";
import { formatDisplayText } from "./message.js";
import { generateLocalToken } from "./local-token.js";
import { AgentSessionManager } from "./agent-manager.js";
import { SettingsStore } from "./settings-store.js";
import { loadExternalProviders, registerAllCapabilities, capabilities } from "./providers/registry.js";
import { getGatewayService } from "./gateway/service.js";
import { parseWebSessionKey } from "./gateway/protocol.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // Initialize analytics sink (SQLite) — must be early so queued events drain
  const analyticsSink = new SQLiteAnalyticsSink(
    join(CONFIG_DIR, "analytics.db"),
  );
  attachAnalyticsSink(analyticsSink);

  const gateway = getGatewayService();
  generateLocalToken();

  // Initialize settings store (SQLite)
  const settingsStore = new SettingsStore();

  // Run per-user directory migration if needed
  const { runMigrationIfNeeded } = await import("./migration/user-dirs.js");
  await runMigrationIfNeeded();

  // Load external providers and register all factories + capabilities
  await loadExternalProviders();
  registerAllCapabilities();
  await capabilities.startServices();

  // Initialize agent session manager
  const agentManager = new AgentSessionManager(settingsStore);

  // Initialize MCP connections (uses engine's getAllMcpConfigs + getMcpToolsCommandsAndResources)
  await agentManager.initMcp();

  const defaultModel = settingsStore.getDefaultModel();
  console.log(
    `[Agent] Initialized (model=${defaultModel?.model ?? "none"}, maxSessions=${settingsStore.getNumber("max_sessions", 20)})`,
  );

  // Initialize cost tracker with per-model pricing from SettingsStore
  const { setModelPricing } = await import("./engine/cost-tracker.js");
  for (const model of settingsStore.listModels()) {
    if (model.cost) {
      setModelPricing(model.model, {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      });
    }
  }

  // Migrate config.yaml skills section to SettingsStore (one-time)
  const { decryptCred, encryptCred } = await import("./channels/channel-creds.js");
  const { migrateSkillsConfigIfNeeded } = await import("./migration/skills-config.js");
  migrateSkillsConfigIfNeeded(settingsStore, encryptCred);

  // Skill filter is set per-user in agent-manager.chat() before each query

  // Initialize message persistence (JSONL transcripts)
  const { MessageStore } = await import("./message-store.js");
  const transcriptsCfg = {
    transcriptsDir: settingsStore.get("transcripts.dir") ?? undefined,
    maxFiles: settingsStore.getNumber("transcripts.max_files", 200),
    maxAgeDays: settingsStore.getNumber("transcripts.max_age_days", 30),
  };
  const { loadTranscriptsConfig } = await import("./config.js");
  const messageStore = new MessageStore(
    transcriptsCfg.transcriptsDir
      ? { transcriptsDir: transcriptsCfg.transcriptsDir, maxFiles: transcriptsCfg.maxFiles, maxAgeDays: transcriptsCfg.maxAgeDays }
      : loadTranscriptsConfig(),
  );
  messageStore.prune();
  agentManager.setMessageStore(messageStore);

  // Build handler
  const handler = async (
    msg: InboundMessage,
  ): Promise<string | null> => {
    const trimmed = msg.text.trim();

    if (trimmed === "/help") return t("cmd_help");

    if (["/new", "/reset", "/clear"].includes(trimmed)) {
      await agentManager.reset(msg.sessionKey);
      return t("cmd_reset");
    }

    // /skills command — engine handles skill listing via SkillTool

    const webSession = parseWebSessionKey(msg.sessionKey);
    const onEvent = webSession
      ? gateway.createAgentEventForwarder(webSession)
      : undefined;

    const sendWs = webSession
      ? gateway.sendEvent.bind(gateway)
      : undefined;
    return await agentManager.chat(msg.sessionKey, msg.text, onEvent, sendWs);
  };

  // ---------------------------------------------------------------------------
  // Initialize web channel stores (web channel needs extra services)
  // ---------------------------------------------------------------------------

  let inviteStoreInstance: { close(): void } | null = null;
  let userStoreInstance: { close(): void } | null = null;
  const channelNames = getChannelNames();

  // Web services (passed via ChannelContext.services)
  const webServices: Record<string, unknown> = {};

  if (channelNames.includes("web")) {
    const { InviteStore } = await import("./invite-store.js");
    const inviteStore = new InviteStore();
    inviteStoreInstance = inviteStore;

    const { UserStore } = await import("./user-store.js");
    const webCfg = loadWebConfig();
    const sessionMaxAgeDays = settingsStore.getNumber("web.session_max_age_days", webCfg.sessionMaxAgeDays);
    const sessionMaxAgeMs = sessionMaxAgeDays * 24 * 60 * 60 * 1000;
    const userStore = new UserStore(undefined, sessionMaxAgeMs);
    userStoreInstance = userStore;

    const pruned = userStore.pruneExpiredSessions();
    if (pruned > 0) {
      console.log(`[UserStore] Pruned ${pruned} expired auth session(s)`);
    }

    webServices.messageStore = messageStore;
    webServices.inviteStore = inviteStore;
    webServices.userStore = userStore;
    webServices.settingsStore = settingsStore;
    webServices.handler = handler;
    webServices.agentManager = agentManager;
    webServices.analyticsSink = analyticsSink;
  }

  // ---------------------------------------------------------------------------
  // ChannelManager: centralized lifecycle for all channels
  // ---------------------------------------------------------------------------

  const manager = new ChannelManager({
    handler,
    settingsStore,
    messageStore,
    buildNotify: (ownerId) => (sessionKey, role, text) => {
      const event = { type: "channel_message" as const, sessionKey, role, text };
      if (ownerId) gateway.sendEvent(ownerId, event);
      else gateway.broadcastEvent(event);
    },
    services: webServices,
  });

  // Register all channel plugins + pass manager to web services for hot-start
  webServices.channelManager = manager;
  manager.register(webPlugin);
  manager.register(feishuPlugin);
  manager.register(dingtalkPlugin);
  manager.register(wechatPlugin);
  manager.register(qqPlugin);
  manager.register(wecomPlugin);
  manager.register(telegramPlugin);
  manager.register(imessagePlugin);
  manager.register(whatsappPlugin);

  // Cron executor
  const cronExecutor = (sessionKey: string, prompt: string) =>
    agentManager.chat(sessionKey, prompt);

  // Initialize cron scheduler if configured
  let cronScheduler: import("./cron.js").CronScheduler | null = null;
  const cronEnabled = settingsStore.getBool("cron.enabled", false);
  if (cronEnabled) {
    const tasks = settingsStore.listTasks();
    const { CronScheduler } = await import("./cron.js");
    const deliverers = manager.buildDeliverers();
    cronScheduler = new CronScheduler(
      {
        enabled: true,
        tasks,
        maxConcurrentRuns: settingsStore.getNumber("cron.max_concurrent_runs", 0) || undefined,
      },
      cronExecutor,
      deliverers,
    );
    cronScheduler.start();
    console.log("[Cron] Scheduler started");

    // Pass cron scheduler to web channel via services
    if (channelNames.includes("web")) {
      webServices.cronScheduler = cronScheduler;
    }
  }

  try {
    await manager.startAll();
  } finally {
    console.log("[Klaus] Shutting down...");
    cronScheduler?.stop();
    await capabilities.stopServices();
    await agentManager.disposeAll();
    inviteStoreInstance?.close();
    userStoreInstance?.close();
    settingsStore.close();
    console.log("[Klaus] Cleanup complete.");
  }
}

async function main(): Promise<void> {
  await start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
