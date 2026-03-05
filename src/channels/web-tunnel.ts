/**
 * Cloudflare Tunnel integration for the web channel.
 * Uses `cloudflared tunnel --url` (quick tunnel, no account needed).
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";

export function startTunnel(port: number, token?: string): ChildProcess | null {
  try {
    execSync("which cloudflared", { stdio: "pipe" });
  } catch {
    console.warn(
      "[Web] cloudflared not found. Install it for public URL access:\n" +
        "  macOS: brew install cloudflared\n" +
        "  Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n" +
        "\nContinuing with localhost only.",
    );
    return null;
  }

  console.log("[Web] Starting Cloudflare Tunnel...");

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
        const publicUrl = match[0];
        console.log(`[Web] Tunnel URL: ${publicUrl}`);
        if (token) {
          console.log(`[Web] Public Chat URL: ${publicUrl}/?token=${token}`);
        }
      }
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[Web] Cloudflare Tunnel exited with code ${code}`);
    }
  });

  return child;
}
