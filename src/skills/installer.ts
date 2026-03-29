/**
 * Skill dependency installer — runs package manager commands for missing binaries.
 *
 * Supported kinds: brew, npm, go, uv.
 * After install, clears binary cache and invalidates the skill registry.
 */

import { spawn } from "node:child_process";
import { getSkillRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const INSTALL_KINDS = ["brew", "npm", "go", "uv"] as const;

export interface InstallSpec {
  readonly id: string;
  readonly kind: (typeof INSTALL_KINDS)[number];
  readonly formula?: string;
  readonly package?: string;
  readonly module?: string;
  readonly label: string;
}

interface InstallResult {
  readonly ok: boolean;
  readonly message: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null; // null = timeout
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SAFE_PACKAGE_RE = /^[@a-zA-Z0-9._\/-]+$/;

function validatePackageName(name: string): void {
  if (!name || !SAFE_PACKAGE_RE.test(name)) {
    throw new Error(`Invalid package name: "${name}"`);
  }
}

// ---------------------------------------------------------------------------
// Command builders
// ---------------------------------------------------------------------------

function buildCommand(spec: InstallSpec): { cmd: string; args: string[] } {
  switch (spec.kind) {
    case "brew": {
      const formula = spec.formula ?? spec.package;
      if (!formula) throw new Error("brew install requires formula");
      validatePackageName(formula);
      return { cmd: "brew", args: ["install", formula] };
    }
    case "npm": {
      const pkg = spec.package;
      if (!pkg) throw new Error("npm install requires package");
      validatePackageName(pkg);
      return { cmd: "npm", args: ["install", "-g", pkg] };
    }
    case "go": {
      const mod = spec.module ?? spec.package;
      if (!mod) throw new Error("go install requires module");
      validatePackageName(mod);
      return { cmd: "go", args: ["install", mod] };
    }
    case "uv": {
      const pkg = spec.package;
      if (!pkg) throw new Error("uv install requires package");
      validatePackageName(pkg);
      return { cmd: "uv", args: ["tool", "install", pkg] };
    }
    default:
      throw new Error(`Unsupported install kind: "${(spec as InstallSpec).kind}"`);
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function clampTimeout(ms?: number): number {
  if (!ms) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, ms));
}

export async function installSkillDep(
  spec: InstallSpec,
  timeoutMs?: number,
): Promise<InstallResult> {
  const { cmd, args } = buildCommand(spec);
  const timeout = clampTimeout(timeoutMs);

  return new Promise<InstallResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let finished = false;

    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGTERM");
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").slice(-8192);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(-8192);
      resolve({
        ok: false,
        message: `${spec.label}: timed out after ${timeout / 1000}s`,
        stdout,
        stderr,
        code: null,
      });
    }, timeout);

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").slice(-8192);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(-8192);
      const ok = code === 0;

      // Clear binary cache and invalidate registry so eligibility re-checks
      if (ok) {
        getSkillRegistry().resetBinCache();
      }

      resolve({
        ok,
        message: ok
          ? `${spec.label}: installed successfully`
          : `${spec.label}: failed (exit code ${code})`,
        stdout,
        stderr,
        code,
      });
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        message: `${spec.label}: ${err.message}`,
        stdout: "",
        stderr: err.message,
        code: null,
      });
    });
  });
}
