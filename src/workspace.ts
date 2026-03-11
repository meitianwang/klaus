/**
 * Per-user workspace isolation.
 *
 * Each user gets a dedicated directory under ~/.klaus/workspaces/{userId}/.
 * The Claude Agent SDK `cwd` option restricts file access to this directory.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";

const WORKSPACES_DIR = join(CONFIG_DIR, "workspaces");

/** Valid userId: 32 hex chars (from UserStore randomBytes(16).toString("hex")) */
const VALID_USER_ID_RE = /^[0-9a-f]{32}$/;

function validateUserId(userId: string): void {
  if (!VALID_USER_ID_RE.test(userId)) {
    throw new Error(`Invalid userId for workspace: ${userId}`);
  }
}

/**
 * Ensure the user's workspace directory exists and return its absolute path.
 * Creates the directory tree on first call.
 */
export function ensureWorkspace(userId: string): string {
  validateUserId(userId);
  const dir = join(WORKSPACES_DIR, userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the workspace path for a user (without creating it).
 */
export function getWorkspacePath(userId: string): string {
  validateUserId(userId);
  return join(WORKSPACES_DIR, userId);
}

/**
 * Extract userId from a session key.
 * Session key format: "web:{userId}:{sessionId}" or "cron:{id}".
 * Returns undefined for non-user session keys (e.g. cron).
 */
export function extractUserId(sessionKey: string): string | undefined {
  if (sessionKey.startsWith("web:")) {
    const parts = sessionKey.split(":");
    // web:{userId}:{sessionId}
    if (parts.length >= 3) return parts[1];
  }
  return undefined;
}
