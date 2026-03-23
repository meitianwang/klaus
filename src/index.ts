import { webPlugin } from "./channels/web.js";
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
import { sendWsEvent } from "./channels/web.js";
import type { AgentEvent } from "klaus-agent";

// ---------------------------------------------------------------------------
// Channel registration
// ---------------------------------------------------------------------------

registerChannel(webPlugin);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // Generate local token for macOS app authentication
  generateLocalToken();

  // Initialize settings store (SQLite)
  const settingsStore = new SettingsStore();

  // Load external providers and register all factories + capabilities
  await loadExternalProviders();
  registerAllFactories();
  registerAllCapabilities();
  await capabilities.startServices();

  // Initialize agent session manager
  const agentManager = new AgentSessionManager(settingsStore);
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

  // Expose stores to web channel for API endpoints
  let inviteStoreInstance: { close(): void } | null = null;
  let userStoreInstance: { close(): void } | null = null;
  if (channelNames.includes("web")) {
    const {
      setMessageStore,
      setInviteStore,
      setUserStore,
      setSettingsStore,
    } = await import("./channels/web.js");
    setMessageStore(messageStore);
    setSettingsStore(settingsStore);

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

    // Store user message in transcripts
    const display = formatDisplayText(msg);
    if (display) {
      messageStore
        .append(msg.sessionKey, "user", display)
        .catch((err) => console.error("[MessageStore] Append failed:", err));
    }

    // Extract userId and sessionId for streaming
    const parts = msg.sessionKey.split(":");
    const userId = parts[1];
    const sessionId = parts.slice(2).join(":");

    // Stream agent events to WebSocket
    const onEvent = (event: AgentEvent) => {
      if (
        event.type === "message_update" &&
        event.event.type === "text"
      ) {
        sendWsEvent(userId, {
          type: "stream",
          chunk: event.event.text,
          sessionId,
        });
      }
    };

    const reply = await agentManager.chat(msg.sessionKey, msg.text, onEvent);

    // Store assistant reply in transcripts
    if (reply) {
      messageStore
        .append(msg.sessionKey, "assistant", reply)
        .catch((err) => console.error("[MessageStore] Append failed:", err));
    }

    return reply;
  };

  try {
    await Promise.all(plugins.map((p) => p.start(handler)));
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
  const cmd = process.argv[2] ?? "start";

  switch (cmd) {
    case "start":
      await start();
      break;
    default:
      console.log(
        "Klaus\n\n" +
          "Usage: klaus [command]\n\n" +
          "Commands:\n" +
          "  start    Start the server (default)\n",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
