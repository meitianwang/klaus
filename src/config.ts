import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import yaml from "js-yaml";
import type {
  QQBotConfig,
  WeComConfig,
  WebConfig,
  SessionConfig,
  TranscriptsConfig,
  TunnelConfig,
} from "./types.js";

export const CONFIG_DIR = join(homedir(), ".klaus");
export const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");

export function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  const content = readFileSync(CONFIG_FILE, "utf-8");
  return (yaml.load(content) as Record<string, unknown>) ?? {};
}

export function saveConfig(data: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, yaml.dump(data, { flowLevel: -1 }), "utf-8");
}

export function getChannelName(): string {
  const cfg = loadConfig();
  return (cfg.channel as string) ?? "qq";
}

export function loadQQBotConfig(): QQBotConfig {
  const cfg = (loadConfig().qq as Record<string, string>) ?? {};
  return {
    appid: cfg.appid ?? process.env.QQ_BOT_APPID ?? "",
    secret: cfg.secret ?? process.env.QQ_BOT_SECRET ?? "",
  };
}

export function loadWeComConfig(): WeComConfig {
  const cfg = (loadConfig().wecom as Record<string, unknown>) ?? {};
  return {
    corpId: (cfg.corp_id as string) ?? process.env.WECOM_CORP_ID ?? "",
    corpSecret:
      (cfg.corp_secret as string) ?? process.env.WECOM_CORP_SECRET ?? "",
    agentId: Number(cfg.agent_id ?? process.env.WECOM_AGENT_ID ?? 0),
    token: (cfg.token as string) ?? process.env.WECOM_TOKEN ?? "",
    encodingAesKey:
      (cfg.encoding_aes_key as string) ??
      process.env.WECOM_ENCODING_AES_KEY ??
      "",
    port: Number(cfg.port ?? process.env.WECOM_PORT ?? 8080),
  };
}

function parseTunnelConfig(
  raw: unknown,
  envTunnel: string | undefined,
): TunnelConfig | false {
  // boolean true (backward compat) or env "true" → quick tunnel
  if (raw === true || (raw == null && envTunnel === "true")) {
    return { provider: "cloudflare-quick" };
  }

  // boolean false or absent → no tunnel
  if (raw === false || raw == null) {
    return false;
  }

  // object → parse by provider
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const provider = obj.provider as string;

    switch (provider) {
      case "cloudflare-quick":
        return { provider: "cloudflare-quick" };
      case "cloudflare":
        return {
          provider: "cloudflare",
          token: String(obj.token ?? ""),
          ...(obj.hostname ? { hostname: String(obj.hostname) } : {}),
        };
      case "ngrok":
        return {
          provider: "ngrok",
          authtoken: String(obj.authtoken ?? ""),
          ...(obj.domain ? { domain: String(obj.domain) } : {}),
        };
      case "custom":
        return {
          provider: "custom",
          url: String(obj.url ?? ""),
          ...(obj.command ? { command: String(obj.command) } : {}),
        };
      default:
        console.warn(
          `[Web] Unknown tunnel provider "${provider}", using quick tunnel`,
        );
        return { provider: "cloudflare-quick" };
    }
  }

  // Truthy non-object (string "true" etc) → quick tunnel
  if (raw) {
    return { provider: "cloudflare-quick" };
  }

  return false;
}

export function loadWebConfig(): WebConfig {
  const cfg = (loadConfig().web as Record<string, unknown>) ?? {};
  let token = (cfg.token as string) ?? process.env.KLAUS_WEB_TOKEN ?? "";
  // Guard: auto-generate if token is empty or a placeholder value
  if (!token || token === "(auto-generate)") {
    token = randomBytes(24).toString("hex");
    console.log(`[Web] Auto-generated token: ${token}`);
    // Persist the generated token so it stays stable across restarts
    try {
      const full = loadConfig();
      const webCfg = (full.web as Record<string, unknown>) ?? {};
      webCfg.token = token;
      full.web = webCfg;
      saveConfig(full);
    } catch {
      // Non-fatal: token works for this session even if save fails
    }
  }
  return {
    token,
    port: Number(cfg.port ?? process.env.KLAUS_WEB_PORT ?? 3000),
    tunnel: parseTunnelConfig(cfg.tunnel, process.env.KLAUS_WEB_TUNNEL),
    permissions: Boolean(
      cfg.permissions ?? process.env.KLAUS_WEB_PERMISSIONS === "true",
    ),
  };
}

function positiveNumber(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadSessionConfig(): SessionConfig {
  const cfg = (loadConfig().session as Record<string, unknown>) ?? {};
  return {
    idleMs: positiveNumber(cfg.idle_minutes, 240) * 60 * 1000,
    maxEntries: Math.floor(positiveNumber(cfg.max_entries, 100)),
    maxAgeMs: positiveNumber(cfg.max_age_days, 7) * 24 * 60 * 60 * 1000,
  };
}

export function loadTranscriptsConfig(): TranscriptsConfig {
  const cfg = (loadConfig().transcripts as Record<string, unknown>) ?? {};
  return {
    transcriptsDir: (cfg.dir as string) ?? join(CONFIG_DIR, "transcripts"),
    maxFiles: Math.floor(positiveNumber(cfg.max_files, 200)),
    maxAgeDays: positiveNumber(cfg.max_age_days, 30),
  };
}
