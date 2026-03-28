/**
 * QQ Bot API client.
 * Handles OAuth token, WebSocket gateway URL, and message sending.
 *
 * API base: https://api.sgroup.qq.com
 * Token URL: https://bots.qq.com/app/getAppAccessToken
 */

import type { MessageResponse } from "./qq-types.js";

const API_BASE = "https://api.sgroup.qq.com";
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const DEFAULT_TIMEOUT_MS = 30_000;

// QQ openid: 32-char uppercase hex or UUID format
const OPENID_PATTERN = /^[0-9a-fA-F-]{32,36}$/;

function validateOpenid(id: string, label: string): void {
  if (!OPENID_PATTERN.test(id)) {
    throw new Error(`Invalid QQ ${label}: ${id.slice(0, 20)}`);
  }
}

// ---------------------------------------------------------------------------
// Token management (cached per appId + singleflight)
// ---------------------------------------------------------------------------

const tokenCacheMap = new Map<string, { token: string; expiresAt: number }>();
const tokenFetchPromises = new Map<string, Promise<string>>();

export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  const cached = tokenCacheMap.get(appId);
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token;
  }

  const existing = tokenFetchPromises.get(appId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, clientSecret }),
      });

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) {
        throw new Error(`Failed to get QQ Bot access_token: ${JSON.stringify(data)}`);
      }

      const expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
      tokenCacheMap.set(appId, { token: data.access_token, expiresAt });
      console.log(`[QQ] Token obtained for appId=${appId}, expires at ${new Date(expiresAt).toISOString()}`);
      return data.access_token;
    } finally {
      tokenFetchPromises.delete(appId);
    }
  })();

  tokenFetchPromises.set(appId, promise);
  return promise;
}

export function clearTokenCache(appId?: string): void {
  if (appId) {
    tokenCacheMap.delete(appId);
  } else {
    tokenCacheMap.clear();
  }
}

// ---------------------------------------------------------------------------
// API request helper
// ---------------------------------------------------------------------------

async function apiRequest<T = unknown>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `QQBot ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`QQ API [${path}] HTTP ${res.status}: ${rawText.slice(0, 300)}`);
    }
    return JSON.parse(rawText) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Gateway URL
// ---------------------------------------------------------------------------

export async function getGatewayUrl(accessToken: string): Promise<string> {
  const data = await apiRequest<{ url: string }>(accessToken, "GET", "/gateway");
  return data.url;
}

// ---------------------------------------------------------------------------
// Probe credentials (validate AppID + Secret)
// ---------------------------------------------------------------------------

export async function probeQQBotCredentials(params: {
  appId: string;
  clientSecret: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // getAccessToken validates credentials by calling the token endpoint
    await getAccessToken(params.appId, params.clientSecret);
    return { ok: true };
  } catch (err) {
    clearTokenCache(params.appId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Message sending
// ---------------------------------------------------------------------------

function getNextMsgSeq(): number {
  const timePart = Date.now() % 100_000_000;
  const random = Math.floor(Math.random() * 65536);
  return (timePart ^ random) % 65536;
}

function buildTextMessage(content: string, msgId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content,
    msg_type: 0, // text
    msg_seq: getNextMsgSeq(),
  };
  if (msgId) body.msg_id = msgId;
  return body;
}

/** Send a C2C (private) message */
export async function sendC2CMessage(
  accessToken: string,
  openid: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  validateOpenid(openid, "openid");
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/users/${openid}/messages`, buildTextMessage(content, msgId));
}

/** Send a group message */
export async function sendGroupMessage(
  accessToken: string,
  groupOpenid: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  validateOpenid(groupOpenid, "groupOpenid");
  return apiRequest<MessageResponse>(accessToken, "POST", `/v2/groups/${groupOpenid}/messages`, buildTextMessage(content, msgId));
}

