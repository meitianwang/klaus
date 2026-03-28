/**
 * DingTalk Stream SDK client and access token management.
 * Aligned with openclaw-china/extensions/dingtalk/src/client.ts
 */

import { DWClient } from "dingtalk-stream";
import type { DingtalkConfig } from "./dingtalk-types.js";

// ---------------------------------------------------------------------------
// DWClient creation + cache
// ---------------------------------------------------------------------------

let cachedClient: DWClient | null = null;
let cachedCreds: { clientId: string; clientSecret: string } | null = null;

export function createDingtalkClient(config: DingtalkConfig): DWClient {
  if (
    cachedClient &&
    cachedCreds &&
    cachedCreds.clientId === config.clientId &&
    cachedCreds.clientSecret === config.clientSecret
  ) {
    return cachedClient;
  }

  const client = new DWClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    ua: "klaus-dingtalk",
    keepAlive: true,
  });

  cachedClient = client;
  cachedCreds = { clientId: config.clientId, clientSecret: config.clientSecret };
  return client;
}

// ---------------------------------------------------------------------------
// Access Token (OAuth2)
// ---------------------------------------------------------------------------

const DINGTALK_OAUTH_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const TOKEN_REQUEST_TIMEOUT = 10_000;
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

export async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > now + TOKEN_REFRESH_BUFFER) {
    return cached.accessToken;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT);

  try {
    const response = await fetch(DINGTALK_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DingTalk access token failed: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { accessToken: string; expireIn: number };
    if (!data.accessToken) {
      throw new Error("DingTalk OAuth response missing accessToken");
    }

    tokenCache.set(clientId, {
      accessToken: data.accessToken,
      expiresAt: now + data.expireIn * 1000,
    });

    return data.accessToken;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`DingTalk access token request timed out after ${TOKEN_REQUEST_TIMEOUT}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Probe DingTalk credentials by fetching an access token.
 * Returns true if credentials are valid.
 */
export async function probeDingtalkCredentials(
  config: DingtalkConfig,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await getAccessToken(config.clientId, config.clientSecret);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
