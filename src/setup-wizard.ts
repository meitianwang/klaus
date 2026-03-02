import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { CONFIG_FILE, loadConfig, saveConfig } from "./config.js";
import { setLang, t } from "./i18n.js";

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

async function checkPrerequisites(): Promise<boolean> {
  const [major] = process.versions.node.split(".").map(Number);
  const nodeOk = major >= 18;
  const claudeOk = which("claude") !== null;

  if (nodeOk) {
    p.log.success(t("node_ok", { version: process.version }));
  } else {
    p.log.error(t("node_need"));
  }

  if (claudeOk) {
    p.log.success(t("cli_ok"));
  } else {
    p.log.error(t("cli_not_found"));
  }

  return nodeOk && claudeOk;
}

async function collectQQConfig(): Promise<Record<string, unknown>> {
  p.log.info(t("qq_guide"));

  const result = await p.group({
    appid: () =>
      p.text({
        message: t("qq_appid"),
        validate: (v) => (v ? undefined : "Required"),
      }),
    secret: () =>
      p.text({
        message: t("qq_secret"),
        validate: (v) => (v ? undefined : "Required"),
      }),
  });

  if (p.isCancel(result)) process.exit(0);
  return { appid: result.appid, secret: result.secret };
}

async function collectWeComConfig(): Promise<Record<string, unknown>> {
  p.log.info(t("wecom_guide"));

  const result = await p.group({
    corp_id: () =>
      p.text({
        message: t("wecom_corp_id"),
        validate: (v) => (v ? undefined : "Required"),
      }),
    corp_secret: () =>
      p.text({
        message: t("wecom_secret"),
        validate: (v) => (v ? undefined : "Required"),
      }),
    agent_id: () =>
      p.text({
        message: t("wecom_agent_id"),
        validate: (v) => (/^\d+$/.test(v) ? undefined : "Must be a number"),
      }),
    token: () =>
      p.text({
        message: t("wecom_token"),
        validate: (v) => (v ? undefined : "Required"),
      }),
    encoding_aes_key: () =>
      p.text({
        message: t("wecom_aes_key"),
        validate: (v) => (v ? undefined : "Required"),
      }),
    port: () =>
      p.text({
        message: t("wecom_port"),
        defaultValue: "8080",
        placeholder: "8080",
      }),
  });

  if (p.isCancel(result)) process.exit(0);
  return {
    corp_id: result.corp_id,
    corp_secret: result.corp_secret,
    agent_id: Number(result.agent_id),
    token: result.token,
    encoding_aes_key: result.encoding_aes_key,
    port: Number(result.port) || 8080,
  };
}

async function verifyWeComToken(
  corpId: string,
  corpSecret: string,
): Promise<boolean> {
  const s = p.spinner();
  s.start(t("wecom_verify"));

  try {
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    url.searchParams.set("corpid", corpId);
    url.searchParams.set("corpsecret", corpSecret);

    const resp = await fetch(url.toString());
    const data = (await resp.json()) as { errcode?: number; errmsg?: string };

    if (data.errcode && data.errcode !== 0) {
      s.stop(pc.red(`API error: ${data.errmsg ?? "unknown"}`));
      return false;
    }

    s.stop(pc.green(t("wecom_verify_ok")));
    return true;
  } catch (err) {
    s.stop(pc.red(`${err}`));
    return false;
  }
}

export async function runSetup(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(t("setup_title"))));

  // Step 0: Language
  const lang = await p.select({
    message: "Choose language / 选择语言",
    options: [
      { value: "en" as const, label: "English" },
      { value: "zh" as const, label: "中文" },
    ],
  });
  if (p.isCancel(lang)) process.exit(0);
  setLang(lang);

  // Check existing config
  if (existsSync(CONFIG_FILE)) {
    const existing = loadConfig();
    const ch = (existing.channel as string) ?? "unknown";
    p.log.warn(t("config_exists", { path: CONFIG_FILE, channel: ch }));

    const overwrite = await p.confirm({ message: t("overwrite") });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro(t("setup_cancelled"));
      return;
    }
  }

  // Step 1: Prerequisites
  const s = p.spinner();
  s.start(t("checking"));
  s.stop(t("checking"));
  const prereqOk = await checkPrerequisites();
  if (!prereqOk) {
    p.outro(t("checks_failed"));
    return;
  }

  // Step 2: Choose channel
  const channel = await p.select({
    message: t("choose_channel"),
    options: [
      { value: "qq" as const, label: `qq — ${t("channel_qq")}` },
      { value: "wecom" as const, label: `wecom — ${t("channel_wecom")}` },
    ],
  });
  if (p.isCancel(channel)) process.exit(0);

  // Step 3: Collect channel config
  let channelCfg: Record<string, unknown> = {};
  if (channel === "qq") {
    p.log.step(t("qq_title"));
    channelCfg = await collectQQConfig();
    p.log.success(t("qq_verify_ok"));
  } else if (channel === "wecom") {
    p.log.step(t("wecom_title"));
    channelCfg = await collectWeComConfig();

    // Verify WeCom credentials
    const ok = await verifyWeComToken(
      channelCfg.corp_id as string,
      channelCfg.corp_secret as string,
    );
    if (!ok) {
      const saveAnyway = await p.confirm({
        message: lang === "zh" ? "仍然保存配置?" : "Save config anyway?",
      });
      if (p.isCancel(saveAnyway) || !saveAnyway) {
        p.outro(lang === "zh" ? "已取消。" : "Cancelled.");
        return;
      }
    }
  }

  // Step 4: Bot persona
  p.log.step(t("persona_title"));
  const persona = await p.text({
    message: t("persona_prompt"),
    placeholder: t("persona_placeholder"),
  });
  if (p.isCancel(persona)) process.exit(0);

  if (persona) {
    p.log.success(t("persona_saved"));
  } else {
    p.log.success(t("persona_skipped"));
  }

  // Step 5: Save
  const configData: Record<string, unknown> = { channel };
  if (Object.keys(channelCfg).length > 0) {
    configData[channel] = channelCfg;
  }
  if (persona) {
    configData.persona = persona;
  }

  saveConfig(configData);
  p.log.success(t("config_saved", { path: CONFIG_FILE }));
  p.outro(pc.green(t("setup_done")));
}
