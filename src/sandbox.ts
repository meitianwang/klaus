/**
 * Docker sandbox for tool execution — runs tools in an isolated container.
 *
 * When enabled, wraps tool.execute() to run inside a Docker container.
 * Configured via settings: sandbox.enabled, sandbox.image, sandbox.timeout, sandbox.network.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { SettingsStore } from "./settings-store.js";

interface SandboxConfig {
  enabled: boolean;
  image: string;
  timeout: number;      // seconds
  network: string;      // "none" | "bridge" | custom
  memory: string;       // e.g. "512m"
  workdir: string;      // container workdir
}

const DEFAULTS: SandboxConfig = {
  enabled: false,
  image: "node:22-slim",
  timeout: 30,
  network: "none",
  memory: "512m",
  workdir: "/workspace",
};

export async function loadSandboxConfig(store: SettingsStore): Promise<SandboxConfig> {
  return {
    enabled: await store.getBool("sandbox.enabled", DEFAULTS.enabled),
    image: (await store.get("sandbox.image")) ?? DEFAULTS.image,
    timeout: await store.getNumber("sandbox.timeout", DEFAULTS.timeout),
    network: (await store.get("sandbox.network")) ?? DEFAULTS.network,
    memory: (await store.get("sandbox.memory")) ?? DEFAULTS.memory,
    workdir: (await store.get("sandbox.workdir")) ?? DEFAULTS.workdir,
  };
}

// Validation patterns for Docker arguments to prevent flag injection
const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]{0,255}$/;
const NETWORK_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MEMORY_RE = /^\d+[bkmg]$/i;
const WORKDIR_RE = /^\/[a-zA-Z0-9._\-/]{0,255}$/;

function validateConfig(config: SandboxConfig): void {
  if (!IMAGE_RE.test(config.image)) {
    throw new Error(`Invalid sandbox image: "${config.image}"`);
  }
  if (!NETWORK_RE.test(config.network)) {
    throw new Error(`Invalid sandbox network: "${config.network}"`);
  }
  if (!MEMORY_RE.test(config.memory)) {
    throw new Error(`Invalid sandbox memory: "${config.memory}"`);
  }
  if (!WORKDIR_RE.test(config.workdir)) {
    throw new Error(`Invalid sandbox workdir: "${config.workdir}"`);
  }
}

interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Execute a command inside a Docker container.
 * Container is created and destroyed per-invocation (ephemeral).
 */
export async function sandboxExec(
  config: SandboxConfig,
  command: string,
  opts?: { stdin?: string },
): Promise<SandboxExecResult> {
  validateConfig(config);

  const args = [
    "run", "--rm",
    "--network", config.network,
    "--memory", config.memory,
    "--pids-limit", "64",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--workdir", config.workdir,
    "--name", `klaus-sandbox-${Date.now()}-${randomBytes(3).toString("hex")}`,
    config.image,
    "sh", "-c", command,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

    child.on("error", (err) => {
      reject(new Error(`Failed to start Docker: ${err.message}`));
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    const MAX_OUTPUT = 8192;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutLen < MAX_OUTPUT) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrLen < MAX_OUTPUT) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.timeout * 1000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").slice(0, MAX_OUTPUT);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(0, MAX_OUTPUT);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    if (opts?.stdin) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

