// ---------------------------------------------------------------------------
// Feature gates — must be set before any engine import reads them.
// In dev mode, register-bun-bundle.ts sets these via Bun preload.
// In prod builds (tsup → node), we set them here as a fallback.
// ---------------------------------------------------------------------------
if (!process.env.CLAUDE_CODE_FEATURES) {
  process.env.CLAUDE_CODE_FEATURES = [
    'EXTRACT_MEMORIES',
    'CONTEXT_COLLAPSE',
    'BUILTIN_EXPLORE_PLAN_AGENTS',
    'TRANSCRIPT_CLASSIFIER',
    'BASH_CLASSIFIER',
  ].join(',');
} else {
  // Append missing defaults
  const existing = new Set(process.env.CLAUDE_CODE_FEATURES.split(','));
  for (const f of ['EXTRACT_MEMORIES', 'CONTEXT_COLLAPSE', 'BUILTIN_EXPLORE_PLAN_AGENTS', 'TRANSCRIPT_CLASSIFIER', 'BASH_CLASSIFIER']) {
    existing.add(f);
  }
  process.env.CLAUDE_CODE_FEATURES = [...existing].filter(Boolean).join(',');
}

import { webPlugin } from "./channels/web.js";
import { feishuPlugin } from "./channels/feishu.js";
import { dingtalkPlugin } from "./channels/dingtalk.js";
import { wechatPlugin } from "./channels/wechat.js";
import { qqPlugin } from "./channels/qq.js";
import { wecomPlugin } from "./channels/wecom.js";
import { telegramPlugin } from "./channels/telegram.js";
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
import { loadExternalProviders } from "./providers/registry.js";
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

  // Apply model role overrides so the engine's getDefaultSonnetModel() / getDefaultHaikuModel()
  // return model IDs compatible with this Klaus instance's provider.
  // Roles are set per-model in the admin panel (sonnet / haiku / opus).
  await settingsStore.applyModelEnvOverrides();

  // Run per-user directory migration if needed
  const { runMigrationIfNeeded } = await import("./migration/user-dirs.js");
  await runMigrationIfNeeded();

  // Load external providers (model catalog only)
  await loadExternalProviders();

  // Initialize agent session manager
  const agentManager = new AgentSessionManager(settingsStore);

  // Initialize autoDream (background memory consolidation)
  const { initAutoDream } = await import("./engine/services/autoDream/autoDream.js");
  initAutoDream();

  // Initialize MCP connections (uses engine's getAllMcpConfigs + getMcpToolsCommandsAndResources)
  await agentManager.initMcp();

  const defaultModel = await settingsStore.getDefaultModel();
  const maxSessions = await settingsStore.getNumber("max_sessions", 20);
  console.log(
    `[Agent] Initialized (model=${defaultModel?.model ?? "none"}, maxSessions=${maxSessions})`,
  );

  // Initialize cost tracker with per-model pricing from SettingsStore
  const { setModelPricing } = await import("./engine/cost-tracker.js");
  for (const model of await settingsStore.listModels()) {
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
  await migrateSkillsConfigIfNeeded(settingsStore, encryptCred);

  // Skill filter is set per-user in agent-manager.chat() before each query

  // Initialize message persistence (JSONL transcripts)
  const { MessageStore } = await import("./message-store.js");
  const [transcriptsDir, maxFiles, maxAgeDays] = await Promise.all([
    settingsStore.get("transcripts.dir"),
    settingsStore.getNumber("transcripts.max_files", 200),
    settingsStore.getNumber("transcripts.max_age_days", 30),
  ]);
  const { loadTranscriptsConfig } = await import("./config.js");
  const messageStore = new MessageStore(
    transcriptsDir
      ? { transcriptsDir, maxFiles, maxAgeDays }
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
    return await agentManager.chat(msg.sessionKey, msg.text, onEvent, sendWs, msg.media);
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
    const sessionMaxAgeDays = await settingsStore.getNumber("web.session_max_age_days", webCfg.sessionMaxAgeDays);
    const sessionMaxAgeMs = sessionMaxAgeDays * 24 * 60 * 60 * 1000;
    const userStore = new UserStore(undefined, sessionMaxAgeMs);
    userStoreInstance = userStore;

    const pruned = await userStore.pruneExpiredSessions();
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
  manager.register(whatsappPlugin);

  // Cron executor
  const cronExecutor = (sessionKey: string, prompt: string) =>
    agentManager.chat(sessionKey, prompt);

  // Initialize cron scheduler
  let cronScheduler: import("./cron.js").CronScheduler | null = null;
  {
    const tasks = await settingsStore.listTasks();
    const { CronScheduler } = await import("./cron.js");
    const deliverers = manager.buildDeliverers();
    const maxConcurrentRuns = await settingsStore.getNumber("cron.max_concurrent_runs", 0);
    cronScheduler = new CronScheduler(
      {
        enabled: true,
        tasks,
        maxConcurrentRuns: maxConcurrentRuns || undefined,
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

  // Bridge engine cron tools to Klaus's SQLite + CronScheduler
  const { setKlausCronBridge } = await import("./engine/utils/klausCronBridge.js");
  setKlausCronBridge(settingsStore as any, cronScheduler);

  try {
    await manager.startAll();
  } finally {
    console.log("[Klaus] Shutting down...");
    cronScheduler?.stop();
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
