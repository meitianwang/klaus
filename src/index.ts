import { webPlugin } from "./channels/web.js";
import { feishuPlugin, setFeishuConfig, setFeishuTranscript, setFeishuNotify } from "./channels/feishu.js";
import { dingtalkPlugin, setDingtalkConfig, setDingtalkTranscript, setDingtalkNotify } from "./channels/dingtalk.js";
import { wechatPlugin, setWechatConfig, setWechatTranscript, setWechatNotify } from "./channels/wechat.js";
import { decryptCred } from "./channels/channel-creds.js";
import {
  registerChannel,
  getChannel,
  type ChannelPlugin,
} from "./channels/types.js";
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
import { generateLocalToken } from "./local-token.js";
import { AgentSessionManager } from "./agent-manager.js";
import { SettingsStore } from "./settings-store.js";
import { loadExternalProviders, registerAllFactories, registerAllCapabilities, capabilities } from "./providers/registry.js";
import { getGatewayService } from "./gateway/service.js";
import { parseWebSessionKey } from "./gateway/protocol.js";

// ---------------------------------------------------------------------------
// Channel registration
// ---------------------------------------------------------------------------

registerChannel(webPlugin);
registerChannel(feishuPlugin);
registerChannel(dingtalkPlugin);
registerChannel(wechatPlugin);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const gateway = getGatewayService();
  // Generate local token for macOS app authentication
  generateLocalToken();

  // Initialize settings store (SQLite)
  const settingsStore = new SettingsStore();

  // Load external providers and register all factories + capabilities
  await loadExternalProviders();
  registerAllFactories();
  registerAllCapabilities();
  await capabilities.startServices();

  // Initialize memory system if enabled
  let memoryManager: import("./memory/manager.js").MemoryManager | null = null;
  const memoryConfig = settingsStore.getMemoryConfig();
  if (memoryConfig.enabled) {
    const { MemoryManager } = await import("./memory/manager.js");
    const { join } = await import("node:path");
    const { CONFIG_DIR } = await import("./config.js");
    const memoryDir = join(CONFIG_DIR, "memory");
    const transcriptsDir = settingsStore.get("transcripts.dir") ?? join(CONFIG_DIR, "transcripts");
    memoryManager = new MemoryManager({
      dbPath: join(CONFIG_DIR, "memory.db"),
      config: memoryConfig,
      memoryDir,
      transcriptsDir: memoryConfig.sources.includes("sessions") ? transcriptsDir : undefined,
    });
    await memoryManager.initProvider();
    await memoryManager.sync().catch((err: unknown) => {
      console.warn(`[Memory] Initial sync failed: ${String(err)}`);
    });
    memoryManager.startPeriodicSync();
    memoryManager.startWatcher();
    memoryManager.startSessionListener();
    const status = memoryManager.status();
    console.log(
      `[Memory] Initialized (mode=${status.searchMode}, provider=${status.provider}, model=${status.model}, sources=${memoryConfig.sources.join(",")}, dir=${memoryDir})`,
    );
  }

  // Initialize agent session manager
  const agentManager = new AgentSessionManager(settingsStore);
  if (memoryManager) {
    agentManager.setMemoryManager(memoryManager);
  }
  const defaultModel = settingsStore.getDefaultModel();
  console.log(
    `[Agent] Initialized (model=${defaultModel?.model ?? "none"}, maxSessions=${settingsStore.getNumber("max_sessions", 20)})`,
  );

  const channelNames = getChannelNames();
  const plugins: ChannelPlugin[] = [];
  for (const name of channelNames) {
    const plugin = getChannel(name);
    if (!plugin) {
      console.error(`Internal error: channel "${name}" not registered.`);
      process.exit(1);
    }
    plugins.push(plugin);
  }

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

  // Build delivery registry from active channel plugins (needed by cron)
  const deliverers = new Map<
    string,
    (to: string, text: string) => Promise<void>
  >();
  for (const p of plugins) {
    if (p.deliver) {
      deliverers.set(p.meta.id, p.deliver);
    }
  }

  // Cron executor: uses agent manager (no streaming)
  const cronExecutor = (sessionKey: string, prompt: string) =>
    agentManager.chat(sessionKey, prompt);

  // Initialize cron scheduler if configured
  let cronScheduler: import("./cron.js").CronScheduler | null = null;
  const cronEnabled = settingsStore.getBool("cron.enabled", false);
  if (cronEnabled) {
    const tasks = settingsStore.listTasks();
    const { CronScheduler } = await import("./cron.js");
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
    if (channelNames.includes("web")) {
      const { setCronScheduler } = await import("./channels/web.js");
      setCronScheduler(cronScheduler);
    }
  }

  // Initialize Feishu channel from SettingsStore (configured via admin panel).
  {
    const dbAppId = settingsStore.get("channel.feishu.app_id");
    const dbSecret = decryptCred(settingsStore.get("channel.feishu.app_secret") ?? "");
    const dbEnabled = settingsStore.getBool("channel.feishu.enabled", false);

    if (dbEnabled && dbAppId && dbSecret) {
      const dbOwnerId = settingsStore.get("channel.feishu.owner_id");
      setFeishuConfig({ appId: dbAppId, appSecret: dbSecret });
      setFeishuTranscript((sessionKey, role, text) => messageStore.append(sessionKey, role, text));
      setFeishuNotify((sessionKey, role, text) => {
        const event = { type: "channel_message" as const, sessionKey, role, text };
        if (dbOwnerId) gateway.sendEvent(dbOwnerId, event);
        else gateway.broadcastEvent(event);
      });
      if (!channelNames.includes("feishu")) {
        channelNames.push("feishu");
        const feishu = getChannel("feishu");
        if (feishu) plugins.push(feishu);
      }
      console.log("[Feishu] Enabled (configured via admin panel)");
    }
  }

  // Initialize DingTalk channel from SettingsStore (configured via settings page).
  {
    const dbClientId = settingsStore.get("channel.dingtalk.client_id");
    const dbClientSecret = decryptCred(settingsStore.get("channel.dingtalk.client_secret") ?? "");
    const dbDtEnabled = settingsStore.getBool("channel.dingtalk.enabled", false);

    if (dbDtEnabled && dbClientId && dbClientSecret) {
      const dbDtOwnerId = settingsStore.get("channel.dingtalk.owner_id");
      setDingtalkConfig({ clientId: dbClientId, clientSecret: dbClientSecret });
      setDingtalkTranscript((sessionKey, role, text) => messageStore.append(sessionKey, role, text));
      setDingtalkNotify((sessionKey, role, text) => {
        const event = { type: "channel_message" as const, sessionKey, role, text };
        if (dbDtOwnerId) gateway.sendEvent(dbDtOwnerId, event);
        else gateway.broadcastEvent(event);
      });
      if (!channelNames.includes("dingtalk")) {
        channelNames.push("dingtalk");
        const dt = getChannel("dingtalk");
        if (dt) plugins.push(dt);
      }
      console.log("[DingTalk] Enabled (configured via settings page)");
    }
  }

  // Initialize WeChat channel from SettingsStore (configured via QR login).
  {
    const wxToken = decryptCred(settingsStore.get("channel.wechat.token") ?? "");
    const wxBaseUrl = settingsStore.get("channel.wechat.base_url");
    const wxAccountId = settingsStore.get("channel.wechat.account_id");
    const wxEnabled = settingsStore.getBool("channel.wechat.enabled", false);

    if (wxEnabled && wxToken && wxBaseUrl && wxAccountId) {
      const wxOwnerId = settingsStore.get("channel.wechat.owner_id");
      setWechatConfig({ token: wxToken, baseUrl: wxBaseUrl, accountId: wxAccountId });
      setWechatTranscript((sessionKey, role, text) => messageStore.append(sessionKey, role, text));
      setWechatNotify((sessionKey, role, text) => {
        const event = { type: "channel_message" as const, sessionKey, role, text };
        if (wxOwnerId) gateway.sendEvent(wxOwnerId, event);
        else gateway.broadcastEvent(event);
      });
      if (!channelNames.includes("wechat")) {
        channelNames.push("wechat");
        const wx = getChannel("wechat");
        if (wx) plugins.push(wx);
      }
      console.log("[WeChat] Enabled (configured via QR login)");
    }
  }

  // Expose stores to web channel for API endpoints
  let inviteStoreInstance: { close(): void } | null = null;
  let userStoreInstance: { close(): void } | null = null;
  if (channelNames.includes("web")) {
    const {
      setMessageStore,
      setInviteStore,
      setUserStore,
      setSettingsStore,
      setMemoryManager,
    } = await import("./channels/web.js");
    setMessageStore(messageStore);
    setSettingsStore(settingsStore);
    if (memoryManager) setMemoryManager(memoryManager);

    const { InviteStore } = await import("./invite-store.js");
    const inviteStore = new InviteStore();
    setInviteStore(inviteStore);
    inviteStoreInstance = inviteStore;

    const { UserStore } = await import("./user-store.js");
    const webCfg = loadWebConfig();
    const sessionMaxAgeDays = settingsStore.getNumber("web.session_max_age_days", webCfg.sessionMaxAgeDays);
    const sessionMaxAgeMs = sessionMaxAgeDays * 24 * 60 * 60 * 1000;
    const userStore = new UserStore(undefined, sessionMaxAgeMs);
    setUserStore(userStore);
    userStoreInstance = userStore;

    const pruned = userStore.pruneExpiredSessions();
    if (pruned > 0) {
      console.log(`[UserStore] Pruned ${pruned} expired auth session(s)`);
    }
  }

  const handler = async (
    msg: InboundMessage,
  ): Promise<string | null> => {
    const trimmed = msg.text.trim();

    // /help — list commands
    if (trimmed === "/help") {
      return t("cmd_help");
    }

    // /new, /reset, /clear — reset session
    if (["/new", "/reset", "/clear"].includes(trimmed)) {
      await agentManager.reset(msg.sessionKey);
      return t("cmd_reset");
    }

    // /skills — list enabled skills
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

  // Expose handler + agent manager to web channel
  if (channelNames.includes("web")) {
    const { setHandler, setAgentManager } = await import("./channels/web.js");
    setHandler(handler);
    setAgentManager(agentManager);
  }

  try {
    await Promise.all(plugins.map((p) => p.start(handler)));
  } finally {
    console.log("[Klaus] Shutting down...");
    cronScheduler?.stop();
    await capabilities.stopServices();
    await agentManager.disposeAll();
    await memoryManager?.close();
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
