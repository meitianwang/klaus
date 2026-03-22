import { existsSync } from "node:fs";
import { webPlugin } from "./channels/web.js";
import {
  registerChannel,
  getChannel,
  type ChannelPlugin,
} from "./channels/types.js";
import {
  getChannelNames,
  CONFIG_FILE,
  loadConfig,
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
import { sendWsEvent } from "./channels/web.js";
import type { AgentEvent } from "klaus-agent";

// ---------------------------------------------------------------------------
// Channel registration
// ---------------------------------------------------------------------------

registerChannel(webPlugin);

// ---------------------------------------------------------------------------
// Migration: seed DB from config.yaml on first run
// ---------------------------------------------------------------------------

function seedFromConfig(store: SettingsStore): void {
  // Only seed if no models exist (first run)
  if (store.listModels().length > 0) return;

  const cfg = loadConfig();
  const now = Date.now();

  // Seed model from agent section (if present)
  const agent = (cfg.agent as Record<string, unknown>) ?? {};
  const model = String(agent.model ?? "claude-sonnet-4-20250514");
  const provider = String(agent.provider ?? "anthropic");
  const apiKey = (agent.api_key as string) ?? process.env.ANTHROPIC_API_KEY ?? "";

  store.upsertModel({
    id: "default",
    name: "Default",
    provider,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(agent.base_url ? { baseUrl: String(agent.base_url) } : {}),
    maxContextTokens: Number(agent.max_context_tokens ?? 200_000),
    thinking: String(agent.thinking ?? "off"),
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });

  // Seed prompt from persona (if present)
  const persona = (cfg.persona as string) ?? "";
  if (persona) {
    store.upsertPrompt({
      id: "default",
      name: "Default",
      content: persona,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Seed settings
  const session = (cfg.session as Record<string, unknown>) ?? {};
  const transcripts = (cfg.transcripts as Record<string, unknown>) ?? {};
  const cron = (cfg.cron as Record<string, unknown>) ?? {};

  if (agent.max_sessions != null) store.set("max_sessions", String(agent.max_sessions));
  if (agent.yolo != null) store.set("yolo", String(agent.yolo));

  const webCfg = (cfg.web as Record<string, unknown>) ?? {};
  if (webCfg.session_max_age_days != null) store.set("web.session_max_age_days", String(webCfg.session_max_age_days));
  if (session.max_entries != null) store.set("session.max_entries", String(session.max_entries));
  if (transcripts.max_files != null) store.set("transcripts.max_files", String(transcripts.max_files));
  if (transcripts.max_age_days != null) store.set("transcripts.max_age_days", String(transcripts.max_age_days));
  if (cron.enabled != null) store.set("cron.enabled", String(cron.enabled));
  if (cron.max_concurrent_runs != null) store.set("cron.max_concurrent_runs", String(cron.max_concurrent_runs));

  // Seed cron tasks
  const tasks = Array.isArray(cron.tasks) ? cron.tasks : [];
  for (const raw of tasks) {
    if (typeof raw !== "object" || !raw) continue;
    const t = raw as Record<string, unknown>;
    if (!t.id || !t.schedule || !t.prompt) continue;
    store.upsertTask({
      id: String(t.id),
      name: t.name != null ? String(t.name) : undefined,
      description: t.description != null ? String(t.description) : undefined,
      schedule: String(t.schedule),
      prompt: String(t.prompt),
      enabled: t.enabled !== false,
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log("[Settings] Seeded from config.yaml");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  if (!existsSync(CONFIG_FILE)) {
    console.error("No config found. Create ~/.klaus/config.yaml first.");
    process.exit(1);
  }

  // Generate local token for macOS app authentication
  generateLocalToken();

  // Initialize settings store (SQLite)
  const settingsStore = new SettingsStore();
  seedFromConfig(settingsStore);

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
