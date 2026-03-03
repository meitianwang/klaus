import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import pc from "picocolors";
import { CONFIG_FILE, loadConfig } from "./config.js";

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function check(label: string, ok: boolean, hint = ""): boolean {
  const mark = ok ? pc.green("✓") : pc.red("✗");
  const suffix = !ok && hint ? `  → ${hint}` : "";
  console.log(`  ${mark} ${label}${suffix}`);
  return ok;
}

export function runDoctor(): void {
  console.log("\nKlaus Doctor\n");
  let allOk = true;

  // Node.js version
  const [major] = process.versions.node.split(".").map(Number);
  allOk &&= check(
    `Node.js ${process.version}`,
    major >= 18,
    "need Node.js >= 18",
  );

  // Claude CLI
  const claudePath = which("claude");
  allOk &&= check(
    "Claude Code CLI",
    claudePath !== null,
    "npm i -g @anthropic-ai/claude-code",
  );

  // Config file
  const cfgExists = existsSync(CONFIG_FILE);
  allOk &&= check(
    `Config file (${CONFIG_FILE})`,
    cfgExists,
    "run: klaus setup",
  );

  if (cfgExists) {
    const cfg = loadConfig();
    const channel = (cfg.channel as string) ?? "";
    allOk &&= check(
      `Channel configured: ${channel}`,
      channel === "qq" || channel === "wecom",
      "unknown channel",
    );

    if (channel === "qq") {
      const qqCfg = (cfg.qq as Record<string, string>) ?? {};
      allOk &&= check(
        "QQ Bot credentials",
        Boolean(qqCfg.appid && qqCfg.secret),
        "missing appid or secret",
      );
    } else if (channel === "wecom") {
      const wc = (cfg.wecom as Record<string, unknown>) ?? {};
      const required = [
        "corp_id",
        "corp_secret",
        "agent_id",
        "token",
        "encoding_aes_key",
      ];
      const missing = required.filter((k) => !wc[k]);
      allOk &&= check(
        "WeCom credentials",
        missing.length === 0,
        `missing: ${missing.join(", ")}`,
      );
    }
  }

  console.log();
  if (allOk) {
    console.log(`  ${pc.green("All checks passed!")} Run: klaus start\n`);
  } else {
    console.log(
      "  Some checks failed. Fix the issues above and re-run doctor.\n",
    );
  }
}
