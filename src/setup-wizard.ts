import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CONFIG_FILE, loadConfig, saveConfig } from "./config.js";
import { setLang, t } from "./i18n.js";

const require = createRequire(import.meta.url);

function which(cmd: string): string | null {
  try {
    return execFileSync("which", [cmd], { encoding: "utf-8" }).trim();
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

function getInstallCommand(
  cmd: string,
): { bin: string; args: string[]; display: string } | null {
  if (process.platform === "darwin") {
    return {
      bin: "brew",
      args: ["install", cmd],
      display: `brew install ${cmd}`,
    };
  }
  if (process.platform === "linux" && cmd === "cloudflared") {
    return {
      bin: "sh",
      args: [
        "-c",
        "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared",
      ],
      display: "curl + install cloudflared",
    };
  }
  return null;
}

async function ensureBinaryInstalled(
  cmd: string,
  installHint: string,
): Promise<void> {
  if (which(cmd) !== null) {
    p.log.success(t("web_binary_found", { cmd }));
    return;
  }
  p.log.warn(t("web_binary_not_found", { cmd }));
  p.log.info(installHint);

  const installCmd = getInstallCommand(cmd);
  if (installCmd) {
    const doInstall = await p.confirm({
      message: t("web_binary_auto_install", { cmd: installCmd.display }),
      initialValue: true,
    });
    if (!p.isCancel(doInstall) && doInstall) {
      p.log.info(t("web_binary_installing", { cmd }));
      try {
        execFileSync(installCmd.bin, installCmd.args, {
          stdio: "inherit",
          timeout: 300_000,
        });
        p.log.success(t("web_binary_install_ok", { cmd }));
      } catch {
        p.log.error(t("web_binary_install_fail", { cmd }));
      }
    }
  }
}

async function collectWebConfig(): Promise<Record<string, unknown>> {
  p.log.info(t("web_guide"));

  // Basic config: token + port
  const basic = await p.group({
    token: () =>
      p.text({
        message: t("web_token"),
        placeholder: "(auto-generate)",
        defaultValue: "",
      }),
    port: () =>
      p.text({
        message: t("web_port"),
        defaultValue: "3000",
        placeholder: "3000",
      }),
  });
  if (p.isCancel(basic)) process.exit(0);

  // Auto-generate token if empty or placeholder
  let token = (basic.token as string).trim();
  if (!token || token === "(auto-generate)") {
    token = randomBytes(24).toString("hex");
    p.log.info(t("web_token_generated", { token }));
  }

  // Tunnel mode selection
  const tunnelMode = await p.select({
    message: t("web_tunnel_mode"),
    options: [
      { value: "none" as const, label: t("web_tunnel_none") },
      { value: "cloudflare-quick" as const, label: t("web_tunnel_quick") },
      { value: "cloudflare" as const, label: t("web_tunnel_named") },
      { value: "ngrok" as const, label: t("web_tunnel_ngrok") },
      { value: "custom" as const, label: t("web_tunnel_custom") },
    ],
  });
  if (p.isCancel(tunnelMode)) process.exit(0);

  let tunnelCfg: Record<string, unknown> | boolean = false;

  if (tunnelMode === "cloudflare-quick") {
    tunnelCfg = true; // backward compat: writes `tunnel: true`
    await ensureBinaryInstalled("cloudflared", t("web_cf_install_hint"));
  } else if (tunnelMode === "cloudflare") {
    p.log.info(t("web_tunnel_named_guide"));
    await ensureBinaryInstalled("cloudflared", t("web_cf_install_hint"));
    const named = await p.group({
      token: () =>
        p.text({
          message: t("web_tunnel_cf_token"),
          validate: (v) => (v ? undefined : t("validate_required")),
        }),
      hostname: () =>
        p.text({
          message: t("web_tunnel_cf_hostname"),
          placeholder: "chat.example.com",
          defaultValue: "",
        }),
    });
    if (p.isCancel(named)) process.exit(0);
    tunnelCfg = {
      provider: "cloudflare",
      token: named.token,
      ...(named.hostname ? { hostname: named.hostname } : {}),
    };
  } else if (tunnelMode === "ngrok") {
    p.log.info(t("web_tunnel_ngrok_guide"));
    await ensureBinaryInstalled("ngrok", t("web_ngrok_install_hint"));
    const ngrok = await p.group({
      authtoken: () =>
        p.text({
          message: t("web_tunnel_ngrok_authtoken"),
          validate: (v) => (v ? undefined : t("validate_required")),
        }),
      domain: () =>
        p.text({
          message: t("web_tunnel_ngrok_domain"),
          placeholder: "my-app.ngrok-free.app",
          defaultValue: "",
        }),
    });
    if (p.isCancel(ngrok)) process.exit(0);
    tunnelCfg = {
      provider: "ngrok",
      authtoken: ngrok.authtoken,
      ...(ngrok.domain ? { domain: ngrok.domain } : {}),
    };
  } else if (tunnelMode === "custom") {
    p.log.info(t("web_tunnel_custom_guide"));
    const custom = await p.group({
      url: () =>
        p.text({
          message: t("web_tunnel_custom_url"),
          validate: (v) => {
            if (!v) return t("validate_required");
            try {
              const normalized = /^https?:\/\//i.test(v) ? v : `https://${v}`;
              new URL(normalized);
              return undefined;
            } catch {
              return t("validate_invalid_url");
            }
          },
        }),
      command: () =>
        p.text({
          message: t("web_tunnel_custom_command"),
          placeholder: "frpc -c /path/to/frpc.ini",
          defaultValue: "",
        }),
    });
    if (p.isCancel(custom)) process.exit(0);
    const customUrl = /^https?:\/\//i.test(custom.url as string)
      ? (custom.url as string)
      : `https://${custom.url as string}`;
    tunnelCfg = {
      provider: "custom",
      url: customUrl,
      ...(custom.command ? { command: custom.command } : {}),
    };
  }

  p.log.success(t("web_setup_done"));

  return {
    token,
    port: Number(basic.port) || 3000,
    tunnel: tunnelCfg,
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
      { value: "web" as const, label: `web — ${t("channel_web")}` },
    ],
  });
  if (p.isCancel(channel)) process.exit(0);

  // Step 3: Collect channel config & install deps
  let channelCfg: Record<string, unknown> = {};
  if (channel === "qq") {
    p.log.step(t("qq_title"));

    // Install qq-group-bot if missing (use require.resolve to avoid executing module code)
    try {
      require.resolve("qq-group-bot");
    } catch {
      const s2 = p.spinner();
      s2.start(t("installing_qq_dep"));
      try {
        execSync("npm install -g qq-group-bot", { stdio: "pipe" });
        s2.stop(pc.green(t("qq_dep_ok")));
      } catch {
        s2.stop(pc.yellow(t("qq_dep_fail")));
      }
    }

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
  } else if (channel === "web") {
    p.log.step(t("web_title"));
    channelCfg = await collectWebConfig();
  }

  // Step 4: Bot persona
  p.log.step(t("persona_title"));
  const personaMethod = await p.select({
    message: t("persona_method"),
    options: [
      { value: "clipboard" as const, label: t("persona_from_clipboard") },
      { value: "file" as const, label: t("persona_from_file") },
      { value: "text" as const, label: t("persona_direct") },
      { value: "skip" as const, label: t("persona_skip_option") },
    ],
  });
  if (p.isCancel(personaMethod)) process.exit(0);

  let persona = "";
  if (personaMethod === "clipboard") {
    // Read from system clipboard
    const clipCmd =
      process.platform === "darwin"
        ? "pbpaste"
        : process.platform === "win32"
          ? 'powershell -command "Get-Clipboard"'
          : "xclip -selection clipboard -o";
    try {
      persona = execSync(clipCmd, { encoding: "utf-8" }).trim();
    } catch {
      persona = "";
    }
    if (persona) {
      const preview =
        persona.length > 200 ? persona.slice(0, 200) + "..." : persona;
      p.log.info(t("persona_clipboard_preview") + "\n\n" + preview);
      const ok = await p.confirm({ message: t("persona_clipboard_confirm") });
      if (p.isCancel(ok)) process.exit(0);
      if (!ok) {
        persona = "";
        p.log.warn(t("persona_skipped"));
      } else {
        p.log.success(
          t("persona_saved") +
            ` (${persona.split("\n").length} ${t("persona_lines")})`,
        );
      }
    } else {
      p.log.warn(t("persona_clipboard_empty"));
    }
  } else if (personaMethod === "file") {
    const filePath = await p.text({
      message: t("persona_file_prompt"),
      placeholder: "~/persona.md",
      validate: (v) => {
        if (!v) return t("persona_file_required");
        const resolved = v.startsWith("~")
          ? v.replace("~", process.env.HOME ?? "")
          : v;
        if (!existsSync(resolved)) return t("persona_file_not_found");
        return undefined;
      },
    });
    if (p.isCancel(filePath)) process.exit(0);
    const resolved = (filePath as string).startsWith("~")
      ? (filePath as string).replace("~", process.env.HOME ?? "")
      : (filePath as string);
    persona = readFileSync(resolved, "utf-8").trim();
    p.log.success(
      t("persona_saved") +
        ` (${persona.split("\n").length} ${t("persona_lines")})`,
    );
  } else if (personaMethod === "text") {
    const text = await p.text({
      message: t("persona_prompt"),
      placeholder: t("persona_placeholder"),
    });
    if (p.isCancel(text)) process.exit(0);
    persona = (text as string) ?? "";
    if (persona) {
      p.log.success(t("persona_saved"));
    } else {
      p.log.success(t("persona_skipped"));
    }
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
