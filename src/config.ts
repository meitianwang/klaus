import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import type { QQBotConfig, WeComConfig } from "./types.js";

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
