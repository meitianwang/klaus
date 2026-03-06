/**
 * Tunnel provider system for the web channel.
 * Supports: Cloudflare Quick Tunnel, Cloudflare Named Tunnel, ngrok, Custom.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type {
  TunnelConfig,
  NamedTunnelConfig,
  NgrokTunnelConfig,
  CustomTunnelConfig,
} from "../types.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface TunnelResult {
  readonly child: ChildProcess | null;
  readonly publicUrl: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function logMissing(cmd: string, installHint: string): void {
  console.warn(
    `[Web] ${cmd} not found. Install it:\n${installHint}\n\nContinuing with localhost only.`,
  );
}

// ---------------------------------------------------------------------------
// Provider: Cloudflare Quick Tunnel (random URL, no account)
// ---------------------------------------------------------------------------

function startQuickTunnel(
  port: number,
  webToken?: string,
): TunnelResult | null {
  if (!hasCommand("cloudflared")) {
    logMissing(
      "cloudflared",
      "  macOS: brew install cloudflared\n" +
        "  Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
    return null;
  }

  console.log("[Web] Starting Cloudflare Quick Tunnel...");

  const child = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://localhost:${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let urlFound = false;
  const onData = (chunk: Buffer): void => {
    const text = chunk.toString();
    if (!urlFound) {
      const match = text.match(
        /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/,
      );
      if (match) {
        urlFound = true;
        console.log(`[Web] Tunnel URL: ${match[0]}`);
        if (webToken) {
          console.log(`[Web] Public Chat URL: ${match[0]}/?token=${webToken}`);
        }
      }
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[Web] Cloudflare Quick Tunnel exited with code ${code}`);
    }
  });

  return { child, publicUrl: null };
}

// ---------------------------------------------------------------------------
// Provider: Cloudflare Named Tunnel (fixed hostname, requires token)
// ---------------------------------------------------------------------------

function startNamedTunnel(
  cfg: NamedTunnelConfig,
  _port: number,
  webToken?: string,
): TunnelResult | null {
  if (!hasCommand("cloudflared")) {
    logMissing(
      "cloudflared",
      "  macOS: brew install cloudflared\n" +
        "  Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
    return null;
  }

  const displayHost = cfg.hostname ?? "(configured in CF dashboard)";
  console.log(`[Web] Starting Cloudflare Named Tunnel → ${displayHost}`);

  const child = spawn("cloudflared", ["tunnel", "run", "--token", cfg.token], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[Web][cloudflared] ${text}`);
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[Web] Cloudflare Named Tunnel exited with code ${code}`);
    }
  });

  const publicUrl = cfg.hostname ? `https://${cfg.hostname}` : null;
  if (publicUrl && webToken) {
    console.log(`[Web] Public Chat URL: ${publicUrl}/?token=${webToken}`);
  }

  return { child, publicUrl };
}

// ---------------------------------------------------------------------------
// Provider: ngrok
// ---------------------------------------------------------------------------

function startNgrokTunnel(
  cfg: NgrokTunnelConfig,
  port: number,
  webToken?: string,
): TunnelResult | null {
  if (!hasCommand("ngrok")) {
    logMissing(
      "ngrok",
      "  macOS: brew install ngrok\n  Other: https://ngrok.com/download",
    );
    return null;
  }

  const args = ["http", String(port), "--authtoken", cfg.authtoken];
  if (cfg.domain) {
    args.push("--domain", cfg.domain);
  }

  const displayDomain = cfg.domain ?? "(random ngrok URL)";
  console.log(`[Web] Starting ngrok tunnel → ${displayDomain}`);

  const child = spawn("ngrok", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  // For static domains the URL is known; for random domains, try to extract
  let urlFound = Boolean(cfg.domain);
  const onData = (chunk: Buffer): void => {
    const text = chunk.toString();
    if (!urlFound) {
      const match = text.match(/https:\/\/[a-z0-9-]+\.ngrok[a-z-]*\.\w+/);
      if (match) {
        urlFound = true;
        console.log(`[Web] Tunnel URL: ${match[0]}`);
        if (webToken) {
          console.log(`[Web] Public Chat URL: ${match[0]}/?token=${webToken}`);
        }
      }
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[Web] ngrok exited with code ${code}`);
    }
  });

  const publicUrl = cfg.domain ? `https://${cfg.domain}` : null;
  if (publicUrl && webToken) {
    console.log(`[Web] Public Chat URL: ${publicUrl}/?token=${webToken}`);
  }

  return { child, publicUrl };
}

// ---------------------------------------------------------------------------
// Provider: Custom
// ---------------------------------------------------------------------------

function startCustomTunnel(
  cfg: CustomTunnelConfig,
  webToken?: string,
): TunnelResult | null {
  console.log(`[Web] Custom tunnel URL: ${cfg.url}`);
  if (webToken) {
    console.log(`[Web] Public Chat URL: ${cfg.url}/?token=${webToken}`);
  }

  if (!cfg.command) {
    return { child: null, publicUrl: cfg.url };
  }

  const parts = cfg.command.split(/\s+/).filter(Boolean);
  const bin = parts[0];

  if (!hasCommand(bin)) {
    console.warn(
      `[Web] Custom tunnel command "${bin}" not found. Continuing without tunnel process.`,
    );
    return { child: null, publicUrl: cfg.url };
  }

  console.log(`[Web] Starting custom tunnel command: ${cfg.command}`);

  const child = spawn(bin, parts.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    console.warn(`[Web] Custom tunnel command failed: ${err.message}`);
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    console.log(`[Web][tunnel] ${chunk.toString().trim()}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    console.warn(`[Web][tunnel] ${chunk.toString().trim()}`);
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[Web] Custom tunnel command exited with code ${code}`);
    }
  });

  return { child, publicUrl: cfg.url };
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

export function startTunnel(
  tunnelCfg: TunnelConfig,
  port: number,
  webToken?: string,
): TunnelResult | null {
  switch (tunnelCfg.provider) {
    case "cloudflare-quick":
      return startQuickTunnel(port, webToken);
    case "cloudflare":
      return startNamedTunnel(tunnelCfg, port, webToken);
    case "ngrok":
      return startNgrokTunnel(tunnelCfg, port, webToken);
    case "custom":
      return startCustomTunnel(tunnelCfg, webToken);
  }
}
