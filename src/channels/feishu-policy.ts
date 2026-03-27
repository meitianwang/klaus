/**
 * Feishu access control policies.
 * Aligned with OpenClaw's extensions/feishu/src/policy.ts
 *
 * Controls who can interact with the bot via DM or group chats.
 */

import type { FeishuConfig, FeishuGroupConfig } from "./feishu-types.js";

// ---------------------------------------------------------------------------
// Allowlist matching
// ---------------------------------------------------------------------------

export type AllowlistMatch = {
  allowed: boolean;
  matchKey?: string;
  matchSource?: "wildcard" | "id";
};

function normalizeAllowEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "*") return "*";
  // Strip optional "feishu:" prefix
  const withoutPrefix = trimmed.replace(/^feishu:/i, "");
  return withoutPrefix.trim().toLowerCase();
}

/**
 * Check if a sender ID matches the allowlist.
 * Feishu allowlists are ID-based — mutable display names must never grant access.
 */
export function resolveAllowlistMatch(params: {
  allowFrom: readonly (string | number)[];
  senderId: string;
  senderIds?: readonly (string | null | undefined)[];
}): AllowlistMatch {
  const allowFrom = params.allowFrom
    .map((entry) => normalizeAllowEntry(String(entry)))
    .filter(Boolean);

  if (allowFrom.length === 0) return { allowed: false };
  if (allowFrom.includes("*")) return { allowed: true, matchKey: "*", matchSource: "wildcard" };

  const senderCandidates = [params.senderId, ...(params.senderIds ?? [])]
    .map((entry) => normalizeAllowEntry(String(entry ?? "")))
    .filter(Boolean);

  for (const senderId of senderCandidates) {
    if (allowFrom.includes(senderId)) {
      return { allowed: true, matchKey: senderId, matchSource: "id" };
    }
  }

  return { allowed: false };
}

// ---------------------------------------------------------------------------
// Group config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve per-group config with wildcard fallback.
 */
export function resolveGroupConfig(params: {
  config?: FeishuConfig;
  groupId?: string | null;
}): FeishuGroupConfig | undefined {
  const groups = params.config?.groups ?? {};
  const wildcard = groups["*"];
  const groupId = params.groupId?.trim();
  if (!groupId) return undefined;

  // Direct match
  const direct = groups[groupId];
  if (direct) return direct;

  // Case-insensitive match
  const lowered = groupId.toLowerCase();
  const matchKey = Object.keys(groups).find((key) => key.toLowerCase() === lowered);
  if (matchKey) return groups[matchKey];

  return wildcard;
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Check if a group sender is allowed based on group policy.
 */
export function isGroupAllowed(params: {
  groupPolicy: "open" | "allowlist" | "disabled";
  allowFrom: readonly (string | number)[];
  senderId: string;
  senderIds?: readonly (string | null | undefined)[];
}): boolean {
  if (params.groupPolicy === "disabled") return false;
  if (params.groupPolicy === "open") return true;

  // "allowlist" — sender must be in the allowlist
  return resolveAllowlistMatch({
    allowFrom: params.allowFrom,
    senderId: params.senderId,
    senderIds: params.senderIds,
  }).allowed;
}

/**
 * Check if a DM sender is allowed based on DM policy.
 */
export function isDmAllowed(params: {
  dmPolicy: "open" | "pairing" | "allowlist";
  allowFrom: readonly (string | number)[];
  senderId: string;
}): boolean {
  if (params.dmPolicy === "open") return true;
  if (params.dmPolicy === "pairing") return true; // Klaus handles pairing at session level

  // "allowlist" — sender must be in the allowlist
  return resolveAllowlistMatch({
    allowFrom: params.allowFrom,
    senderId: params.senderId,
  }).allowed;
}

/**
 * Resolve reply policy (whether @mention is required in groups).
 */
export function resolveReplyPolicy(params: {
  isDirectMessage: boolean;
  globalConfig?: FeishuConfig;
  groupConfig?: FeishuGroupConfig;
}): { requireMention: boolean } {
  if (params.isDirectMessage) return { requireMention: false };

  const requireMention =
    params.groupConfig?.requireMention ?? params.globalConfig?.requireMention ?? true;
  return { requireMention };
}
