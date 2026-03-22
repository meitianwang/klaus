import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import type {
  WebConfig,
  TunnelConfig,
  GoogleOAuthConfig,
  TranscriptsConfig,
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

export function getChannelNames(): string[] {
  const cfg = loadConfig();
  const raw = cfg.channel;
  if (Array.isArray(raw)) return raw.map(String);
  return [(raw as string) ?? "web"];
}

export function addChannelToConfig(
  channelId: string,
  channelCfg: Record<string, unknown>,
): void {
  const cfg = loadConfig();
  const raw = cfg.channel;
  const existing: string[] = Array.isArray(raw)
    ? raw.map(String)
    : raw
      ? [String(raw)]
      : [];

  if (!existing.includes(channelId)) {
    existing.push(channelId);
  }
  cfg.channel = existing.length === 1 ? existing[0] : existing;
  cfg[channelId] = channelCfg;
  saveConfig(cfg);
}

export function removeChannelFromConfig(channelId: string): boolean {
  const cfg = loadConfig();
  const raw = cfg.channel;
  const existing: string[] = Array.isArray(raw)
    ? raw.map(String)
    : raw
      ? [String(raw)]
      : [];

  const filtered = existing.filter((c) => c !== channelId);
  if (filtered.length === 0) return false;

  cfg.channel = filtered.length === 1 ? filtered[0] : filtered;
  delete cfg[channelId];
  saveConfig(cfg);
  return true;
}

// ---------------------------------------------------------------------------
// Web config (startup-only, from YAML)
// ---------------------------------------------------------------------------

function parseTunnelConfig(
  raw: unknown,
  envTunnel: string | undefined,
): TunnelConfig | false {
  if (raw === true || (raw == null && envTunnel === "true")) {
    return { provider: "cloudflare-quick" };
  }
  if (raw === false || raw == null) {
    return false;
  }
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
      case "frp":
        return {
          provider: "frp",
          server_addr: String(obj.server_addr ?? ""),
          server_port: Math.floor(positiveNumber(obj.server_port, 7000)),
          token: String(obj.token ?? ""),
          ...(obj.proxy_type === "tcp"
            ? { proxy_type: "tcp" as const }
            : { proxy_type: "http" as const }),
          ...(Array.isArray(obj.custom_domains)
            ? { custom_domains: obj.custom_domains.map(String) }
            : {}),
          ...(obj.remote_port != null
            ? { remote_port: Math.floor(Number(obj.remote_port)) }
            : {}),
          ...(obj.proxy_name ? { proxy_name: String(obj.proxy_name) } : {}),
          ...(obj.tls_enable === true ? { tls_enable: true } : {}),
          ...(obj.transport_protocol === "websocket"
            ? { transport_protocol: "websocket" as const }
            : {}),
        };
      default:
        console.warn(
          `[Web] Unknown tunnel provider "${provider}", using quick tunnel`,
        );
        return { provider: "cloudflare-quick" };
    }
  }
  if (raw) {
    return { provider: "cloudflare-quick" };
  }
  return false;
}

export function loadWebConfig(): WebConfig {
  const cfg = (loadConfig().web as Record<string, unknown>) ?? {};

  let google: GoogleOAuthConfig | undefined;
  const googleCfg = cfg.google as Record<string, unknown> | undefined;
  if (googleCfg) {
    const clientId =
      (googleCfg.client_id as string) ??
      process.env.KLAUS_GOOGLE_CLIENT_ID ??
      "";
    const clientSecret =
      (googleCfg.client_secret as string) ??
      process.env.KLAUS_GOOGLE_CLIENT_SECRET ??
      "";
    if (clientId && clientSecret) {
      google = { clientId, clientSecret };
    }
  }

  return {
    port: Number(cfg.port ?? process.env.KLAUS_WEB_PORT ?? 3000),
    tunnel: parseTunnelConfig(cfg.tunnel, process.env.KLAUS_WEB_TUNNEL),
    sessionMaxAgeDays: positiveNumber(cfg.session_max_age_days, 7),
    ...(google ? { google } : {}),
  };
}

// ---------------------------------------------------------------------------
// Transcripts config (fallback for initial seed)
// ---------------------------------------------------------------------------

export function loadTranscriptsConfig(): TranscriptsConfig {
  const cfg = (loadConfig().transcripts as Record<string, unknown>) ?? {};
  return {
    transcriptsDir: (cfg.dir as string) ?? join(CONFIG_DIR, "transcripts"),
    maxFiles: Math.floor(positiveNumber(cfg.max_files, 200)),
    maxAgeDays: positiveNumber(cfg.max_age_days, 30),
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function positiveNumber(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseRelativeTime(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!/^\d/.test(trimmed)) return undefined;
  if (/^\d{4}-\d{2}/.test(trimmed)) return undefined;

  let totalMs = 0;
  const re = /(\d+)\s*(s|sec|m|min|h|hr|d|day)s?/g;
  let match: RegExpExecArray | null;
  let matched = false;

  while ((match = re.exec(trimmed)) !== null) {
    matched = true;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "s":
      case "sec":
        totalMs += value * 1000;
        break;
      case "m":
      case "min":
        totalMs += value * 60 * 1000;
        break;
      case "h":
      case "hr":
        totalMs += value * 60 * 60 * 1000;
        break;
      case "d":
      case "day":
        totalMs += value * 24 * 60 * 60 * 1000;
        break;
    }
  }

  if (!matched || totalMs <= 0) return undefined;
  return new Date(Date.now() + totalMs).toISOString();
}
