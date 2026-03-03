import { existsSync } from "node:fs";
import { QQChannel } from "./channels/qq.js";
import { WeComChannel } from "./channels/wecom.js";
import { getChannelName, CONFIG_FILE } from "./config.js";
import { ChatSessionManager } from "./core.js";
import { t } from "./i18n.js";
import type { Channel } from "./channels/base.js";

// ---------------------------------------------------------------------------
// Model alias mapping
// ---------------------------------------------------------------------------

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

const CHANNELS: Record<string, new () => Channel> = {
  qq: QQChannel,
  wecom: WeComChannel,
};

async function start(): Promise<void> {
  if (!existsSync(CONFIG_FILE)) {
    console.log("No config found. Starting setup wizard...\n");
    const { runSetup } = await import("./setup-wizard.js");
    await runSetup();
    if (!existsSync(CONFIG_FILE)) return;
  }

  const channelName = getChannelName();
  const ChannelCls = CHANNELS[channelName];

  if (!ChannelCls) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Available: ${Object.keys(CHANNELS).join(", ")}`);
    console.error("Run 'klaus setup' to configure.");
    process.exit(1);
  }

  const sessions = new ChatSessionManager();
  const channel = new ChannelCls();

  const handler = async (
    sessionKey: string,
    text: string,
  ): Promise<string | null> => {
    const trimmed = text.trim();

    // /new, /reset, /clear — reset conversation
    if (["/new", "/reset", "/clear"].includes(trimmed)) {
      await sessions.reset(sessionKey);
      return t("cmd_reset");
    }

    // /help — list commands
    if (trimmed === "/help") {
      return t("cmd_help");
    }

    // /session — show session info
    if (trimmed === "/session") {
      const info = sessions.getSessionInfo(sessionKey);
      return t("cmd_session_info", {
        key: sessionKey,
        status: info.busy ? t("cmd_session_active") : t("cmd_session_idle"),
        model: info.model ?? t("cmd_default_model"),
      });
    }

    // /model [name] — show or switch model
    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
      const arg = trimmed.slice("/model".length).trim();
      if (!arg) {
        const current = sessions.getModel(sessionKey);
        return t("cmd_model_current", {
          model: current ?? t("cmd_default_model"),
        });
      }
      const resolved = MODEL_ALIASES[arg.toLowerCase()] ?? MODEL_ALIASES[arg];
      if (!resolved) {
        return t("cmd_model_unknown", { name: arg });
      }
      sessions.setModel(sessionKey, resolved);
      return t("cmd_model_switched", { model: resolved });
    }

    return sessions.chat(sessionKey, text);
  };

  try {
    await channel.start(handler);
  } finally {
    await sessions.close();
  }
}

function main(): void {
  const cmd = process.argv[2] ?? "start";

  switch (cmd) {
    case "setup":
      import("./setup-wizard.js").then((m) => m.runSetup());
      break;
    case "doctor":
      import("./doctor.js").then((m) => m.runDoctor());
      break;
    case "start":
      start().catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    default:
      console.log(
        "Klaus — Use Claude Code from any messaging platform\n\n" +
          "Usage: klaus [command]\n\n" +
          "Commands:\n" +
          "  setup    Interactive setup wizard\n" +
          "  start    Start the bot (default)\n" +
          "  doctor   Diagnose environment issues\n",
      );
      process.exit(1);
  }
}

main();
