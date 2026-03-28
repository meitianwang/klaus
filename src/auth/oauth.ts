import { randomBytes, createHash } from "node:crypto";
import type { OAuthAuthConfig } from "../providers/types.js";

export type OAuthProviderAuth = OAuthAuthConfig;

interface OAuthTokenResult {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(
  auth: OAuthProviderAuth,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: auth.clientId,
    redirect_uri: redirectUri,
    scope: auth.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...auth.extraParams,
  });
  return `${auth.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(
  auth: OAuthProviderAuth,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthTokenResult> {
  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: auth.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${detail}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

export async function refreshAccessToken(
  auth: OAuthProviderAuth,
  refreshToken: string,
): Promise<OAuthTokenResult> {
  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: auth.clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${detail}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresIn: Number(data.expires_in) || 3600,
  };
}
