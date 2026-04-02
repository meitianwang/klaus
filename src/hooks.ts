/**
 * Hooks system — follows claude-code's hook architecture.
 *
 * Supports command hooks (shell scripts) that run before/after tool execution.
 * Config format matches claude-code's settings.json hooks section:
 *
 * {
 *   "PreToolUse": [{ "matcher": "Write", "hooks": [{ "type": "command", "command": "..." }] }],
 *   "PostToolUse": [...],
 *   "Stop": [...]
 * }
 *
 * Command hooks receive JSON on stdin and may return JSON on stdout to affect behavior.
 */

import { spawn } from "node:child_process";

// ============================================================================
// Types (matching claude-code's schemas/hooks.ts)
// ============================================================================

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "Notification"
  | "SessionStart"
  | "SubagentStop";

export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
  if?: string;
}

export interface HookMatcher {
  matcher?: string;
  hooks: CommandHook[];
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;

// ============================================================================
// Hook output (matches claude-code's HookJSONOutput)
// ============================================================================

export interface HookOutput {
  continue?: boolean;
  decision?: "approve" | "block";
  reason?: string;
  stopReason?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
}

// ============================================================================
// Pre/Post tool hook results
// ============================================================================

export interface PreToolHookResult {
  blocked: boolean;
  reason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContexts: string[];
}

export interface PostToolHookResult {
  additionalContexts: string[];
}

// ============================================================================
// Matching
// ============================================================================

/** Glob-like match: "*" matches anything, "Bash(git *)" matches tool + args pattern. */
function matchesPattern(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true;
  // Wildcard
  if (pattern === "*") return true;
  // Simple glob: convert * to .* for regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function getMatchingHooks(
  config: HooksConfig,
  event: HookEvent,
  matchQuery?: string,
): CommandHook[] {
  const matchers = config[event];
  if (!matchers) return [];

  const result: CommandHook[] = [];
  for (const m of matchers) {
    // No matcher = matches all
    if (!m.matcher || !matchQuery || matchesPattern(m.matcher, matchQuery)) {
      for (const hook of m.hooks) {
        if (hook.type === "command") {
          result.push(hook);
        }
      }
    }
  }
  return result;
}

// ============================================================================
// Command execution
// ============================================================================

const MAX_STDERR_BYTES = 8192;

function executeCommandHook(
  command: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<HookOutput | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }

    const child = spawn(command, [], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        console.warn(`[Hooks] Command timed out after ${timeoutMs}ms: ${command}`);
        resolve(null);
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        clearTimeout(timer);
        resolve(null);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString().slice(0, MAX_STDERR_BYTES - stderr.length);
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        console.error(`[Hooks] Command spawn error: ${err.message}`);
        resolve(null);
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);

        if (stderr) {
          console.warn(`[Hooks] stderr from "${command}": ${stderr.slice(0, 200)}`);
        }

        if (code !== 0) {
          console.warn(`[Hooks] Command exited with code ${code}: ${command}`);
          // Non-zero exit = blocking error (tool should not proceed)
          resolve({ continue: false, reason: `Hook "${command}" failed (exit ${code}): ${stderr.slice(0, 200)}` });
          return;
        }

        // Parse JSON output
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null); // No output = success, continue
          return;
        }

        try {
          resolve(JSON.parse(trimmed) as HookOutput);
        } catch {
          console.warn(`[Hooks] Non-JSON output from "${command}": ${trimmed.slice(0, 100)}`);
          resolve(null);
        }
      }
    });

    // Write JSON input to stdin
    const jsonInput = JSON.stringify(input);
    child.stdin!.write(jsonInput + "\n", "utf8");
    child.stdin!.end();
  });
}

// ============================================================================
// Public API: execute hooks for tool events
// ============================================================================

export async function executePreToolHooks(
  config: HooksConfig,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string,
  signal?: AbortSignal,
): Promise<PreToolHookResult> {
  const hooks = getMatchingHooks(config, "PreToolUse", toolName);
  if (hooks.length === 0) {
    return { blocked: false, additionalContexts: [] };
  }

  const input = {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
  };

  const additionalContexts: string[] = [];
  let updatedInput: Record<string, unknown> | undefined;

  for (const hook of hooks) {
    const timeoutMs = (hook.timeout ?? 30) * 1000;
    const output = await executeCommandHook(hook.command, input, signal, timeoutMs);
    if (!output) continue;

    // Hook explicitly blocked
    if (output.continue === false || output.decision === "block") {
      return {
        blocked: true,
        reason: output.reason ?? output.stopReason ?? `Blocked by hook: ${hook.command}`,
        additionalContexts,
      };
    }

    // Collect additional context
    if (output.hookSpecificOutput?.additionalContext) {
      additionalContexts.push(output.hookSpecificOutput.additionalContext);
    }

    // Hook may modify input
    if (output.hookSpecificOutput?.updatedInput) {
      updatedInput = output.hookSpecificOutput.updatedInput;
    }
  }

  return { blocked: false, updatedInput, additionalContexts };
}

export async function executePostToolHooks(
  config: HooksConfig,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: unknown,
  toolUseId: string,
  signal?: AbortSignal,
): Promise<PostToolHookResult> {
  const hooks = getMatchingHooks(config, "PostToolUse", toolName);
  if (hooks.length === 0) {
    return { additionalContexts: [] };
  }

  const input = {
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    tool_use_id: toolUseId,
  };

  const additionalContexts: string[] = [];

  for (const hook of hooks) {
    const timeoutMs = (hook.timeout ?? 30) * 1000;
    const output = await executeCommandHook(hook.command, input, signal, timeoutMs);
    if (!output) continue;

    if (output.hookSpecificOutput?.additionalContext) {
      additionalContexts.push(output.hookSpecificOutput.additionalContext);
    }
  }

  return { additionalContexts };
}

export async function executeStopHooks(
  config: HooksConfig,
  signal?: AbortSignal,
): Promise<{ preventContinuation: boolean; reason?: string }> {
  const hooks = getMatchingHooks(config, "Stop");
  if (hooks.length === 0) {
    return { preventContinuation: false };
  }

  const input = { hook_event_name: "Stop" };

  for (const hook of hooks) {
    const timeoutMs = (hook.timeout ?? 30) * 1000;
    const output = await executeCommandHook(hook.command, input, signal, timeoutMs);
    if (!output) continue;

    if (output.continue === false) {
      return { preventContinuation: true, reason: output.stopReason ?? output.reason };
    }
  }

  return { preventContinuation: false };
}
