import { webPlugin } from "./channels/web.js";
import { feishuPlugin } from "./channels/feishu.js";
import { dingtalkPlugin } from "./channels/dingtalk.js";
import { wechatPlugin } from "./channels/wechat.js";
import { qqPlugin } from "./channels/qq.js";
import { wecomPlugin } from "./channels/wecom.js";
import { telegramPlugin } from "./channels/telegram.js";
import { ChannelManager } from "./channels/manager.js";
import {
  getChannelNames,
  loadWebConfig,
} from "./config.js";
import { t } from "./i18n.js";
import type { InboundMessage } from "./message.js";
import { formatDisplayText } from "./message.js";
import {
  loadEnabledSkills,
  listSkillNames,
} from "./skills/index.js";
import { getSkillRegistry } from "./skills/registry.js";
import { generateLocalToken } from "./local-token.js";
import { AgentSessionManager } from "./agent-manager.js";
import { SettingsStore } from "./settings-store.js";
import { loadExternalProviders, registerAllFactories, registerAllCapabilities, capabilities } from "./providers/registry.js";
import { getGatewayService } from "./gateway/service.js";
import { parseWebSessionKey } from "./gateway/protocol.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const gateway = getGatewayService();
  generateLocalToken();

  // Initialize settings store (SQLite)
  const settingsStore = new SettingsStore();

  // Run per-user directory migration if needed
  const { runMigrationIfNeeded } = await import("./migration/user-dirs.js");
  await runMigrationIfNeeded();

  // Load external providers and register all factories + capabilities
  await loadExternalProviders();
  registerAllFactories();
  registerAllCapabilities();
  await capabilities.startServices();

  // Initialize per-user memory pool if enabled
  let memoryPool: import("./memory/pool.js").MemoryManagerPool | null = null;
  const memoryConfig = settingsStore.getMemoryConfig();
  if (memoryConfig.enabled) {
    const { MemoryManagerPool } = await import("./memory/pool.js");
    memoryPool = new MemoryManagerPool(memoryConfig);
    memoryPool.startPeriodicSync();
    console.log(
      `[Memory] Pool initialized (sources=${memoryConfig.sources.join(",")}, per-user isolation enabled)`,
    );
  }

  // Initialize agent session manager
  const agentManager = new AgentSessionManager(settingsStore);
  if (memoryPool) {
    agentManager.setMemoryPool(memoryPool);
  }
  const defaultModel = settingsStore.getDefaultModel();
  console.log(
    `[Agent] Initialized (model=${defaultModel?.model ?? "none"}, maxSessions=${settingsStore.getNumber("max_sessions", 20)})`,
  );

  // Initialize skill registry with hot-reload watcher
  const skillRegistry = getSkillRegistry();
  const { decryptCred } = await import("./channels/channel-creds.js");
  skillRegistry.setApiKeyLookup((name) => {
    const encrypted = settingsStore.get(`skill.${name}.apiKey`);
    if (!encrypted) return undefined;
    const decrypted = decryptCred(encrypted);
    return decrypted || undefined;
  });
  skillRegistry.startWatching();
  const enabledSkills = skillRegistry.getSkills();
  console.log(`[Skills] ${enabledSkills.length} skill(s) loaded, watcher started`);

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

    if (trimmed === "/skills") {
      const enabled = loadEnabledSkills();
      if (enabled.length === 0) {
        return t("cmd_skills_none", {
          available: listSkillNames().join(", "),
        });
      }
      const list = enabled
        .map((s) => {
          const emoji = s.metadata?.emoji ? `${s.metadata.emoji} ` : "";
          const src = s.source === "user" ? " (user)" : "";
          return `  ${emoji}${s.name} — ${s.description}${src}`;
        })
        .join("\n");
      return t("cmd_skills_list", { list, count: String(enabled.length) });
    }

    const webSession = parseWebSessionKey(msg.sessionKey);
    const onEvent = webSession
      ? gateway.createAgentEventForwarder(webSession)
      : undefined;

    return await agentManager.chat(msg.sessionKey, msg.text, onEvent);
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
    if (memoryPool) webServices.memoryPool = memoryPool;
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
    await memoryPool?.closeAll();
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
