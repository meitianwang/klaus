/**
 * Desktop user-auth module — OAuth 2.0 Authorization Code Flow + PKCE,
 * backed by the Klaus web server's /api/auth/desktop/* endpoints.
 *
 * Flow (see plan in original PR description):
 *   1. startLogin() generates a PKCE verifier + challenge + random state,
 *      registers a pending request, and opens the server's /login page in
 *      the system browser with ?desktop=1&state=…&code_challenge=…
 *   2. Web login completes → server 302s to /desktop/auth-success, which
 *      triggers klaus://auth/callback?code=…&state=…
 *   3. Electron's open-url handler forwards the callback URL here.
 *   4. handleCallback() verifies state, POSTs code+verifier to the server,
 *      stores the returned bearer token in ~/.klaus/desktop-auth.json, and
 *      resolves the pending startLogin() promise.
 *
 * Token persistence: plain JSON at 0600 perms. Keytar is not used here to
 * keep the Electron build dependency-free; the file lives inside the user's
 * home which already carries comparable trust.
 */

import { shell } from 'electron'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, chmodSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ---------- Config ----------

const AUTH_FILE = join(homedir(), '.klaus', 'desktop-auth.json')
export const SERVER_URL = 'https://klaus-ai.site'

export interface StoredAuth {
  token: string
  user: {
    id: string
    email: string
    displayName: string
    role: string
    avatarUrl: string | null
  }
  loggedInAt: number
}

interface PendingRequest {
  codeVerifier: string
  state: string
  resolve: (auth: StoredAuth) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

// ---------- PKCE helpers ----------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32))
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest())
}

function generateState(): string {
  return randomBytes(16).toString('hex')
}

// ---------- Token persistence ----------

function readStoredAuth(): StoredAuth | null {
  try {
    if (!existsSync(AUTH_FILE)) return null
    const raw = readFileSync(AUTH_FILE, 'utf8')
    const data = JSON.parse(raw) as StoredAuth
    if (!data?.token || !data?.user?.id) return null
    return data
  } catch (err) {
    console.warn('[KlausAuth] Failed to read stored auth:', err)
    return null
  }
}

function writeStoredAuth(auth: StoredAuth): void {
  mkdirSync(dirname(AUTH_FILE), { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8')
  try { chmodSync(AUTH_FILE, 0o600) } catch { /* best-effort */ }
}

function deleteStoredAuth(): void {
  try { if (existsSync(AUTH_FILE)) unlinkSync(AUTH_FILE) } catch { /* ignore */ }
}

// ---------- Module state ----------

let currentAuth: StoredAuth | null = readStoredAuth()
let pendingRequest: PendingRequest | null = null

// ---------- Public API ----------

/** Currently stored auth (if any). */
export function getCurrentAuth(): StoredAuth | null {
  return currentAuth
}

export interface AuthStatus {
  loggedIn: boolean
  user?: StoredAuth['user']
}

export function getStatus(): AuthStatus {
  if (!currentAuth) return { loggedIn: false }
  return {
    loggedIn: true,
    user: currentAuth.user,
  }
}

/**
 * Kick off the login flow. Opens the server's /login page in the system
 * browser and returns a promise that resolves when the klaus:// callback
 * comes back (or rejects on timeout / protocol error).
 *
 * Only one login can be in flight at a time — calling again while one is
 * pending rejects the previous request.
 */
export async function startLogin(): Promise<StoredAuth> {
  // Cancel any in-flight attempt
  if (pendingRequest) {
    clearTimeout(pendingRequest.timer)
    pendingRequest.reject(new Error('superseded by a new login request'))
    pendingRequest = null
  }

  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = generateState()

  const loginUrl = new URL('/login', SERVER_URL)
  loginUrl.searchParams.set('desktop', '1')
  loginUrl.searchParams.set('state', state)
  loginUrl.searchParams.set('code_challenge', challenge)

  return new Promise<StoredAuth>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequest?.state === state) {
        pendingRequest = null
        reject(new Error('login timed out after 10 minutes'))
      }
    }, 10 * 60 * 1000)

    pendingRequest = {
      codeVerifier: verifier,
      state,
      resolve: (auth) => {
        clearTimeout(timer)
        resolve(auth)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
      timer,
    }

    shell.openExternal(loginUrl.toString()).catch((err) => {
      if (pendingRequest?.state === state) {
        pendingRequest = null
      }
      clearTimeout(timer)
      reject(new Error('failed to open browser: ' + (err?.message || String(err))))
    })
  })
}

/**
 * Called by the main process when a klaus://auth/callback?code=…&state=…
 * URL is received (macOS open-url or Windows/Linux second-instance).
 * Verifies state, exchanges code for token, stores auth, resolves the
 * pending startLogin() promise.
 */
export async function handleCallback(callbackUrl: string): Promise<void> {
  if (!pendingRequest) {
    console.warn('[KlausAuth] Received callback with no pending request:', callbackUrl)
    return
  }

  let parsed: URL
  try {
    parsed = new URL(callbackUrl)
  } catch {
    pendingRequest.reject(new Error('invalid callback URL'))
    pendingRequest = null
    return
  }

  if (parsed.protocol !== 'klaus:' || parsed.host !== 'auth' || parsed.pathname !== '/callback') {
    pendingRequest.reject(new Error('unexpected callback URL: ' + callbackUrl))
    pendingRequest = null
    return
  }

  const code = parsed.searchParams.get('code') ?? ''
  const state = parsed.searchParams.get('state') ?? ''

  if (!code || !state) {
    pendingRequest.reject(new Error('callback missing code or state'))
    pendingRequest = null
    return
  }
  if (state !== pendingRequest.state) {
    pendingRequest.reject(new Error('state mismatch — possible CSRF'))
    pendingRequest = null
    return
  }

  const req = pendingRequest

  try {
    const resp = await fetch(`${SERVER_URL}/api/auth/desktop/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: req.codeVerifier,
        state,
        device_info: `Klaus Desktop/${process.platform}`,
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      req.reject(new Error(`token exchange failed (${resp.status}): ${err.slice(0, 200)}`))
      pendingRequest = null
      return
    }

    const data = (await resp.json()) as { token: string; user: StoredAuth['user'] }
    if (!data?.token || !data?.user) {
      req.reject(new Error('token exchange returned invalid payload'))
      pendingRequest = null
      return
    }

    const auth: StoredAuth = {
      token: data.token,
      user: data.user,
      loggedInAt: Date.now(),
    }
    writeStoredAuth(auth)
    currentAuth = auth
    pendingRequest = null
    req.resolve(auth)
  } catch (err: any) {
    req.reject(new Error('token exchange failed: ' + (err?.message || String(err))))
    pendingRequest = null
  }
}

/**
 * Revoke token on the server (best-effort) and clear local state.
 * Safe to call when not logged in.
 */
export async function logout(): Promise<void> {
  const auth = currentAuth
  if (auth) {
    try {
      await fetch(`${SERVER_URL}/api/auth/desktop/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
      })
    } catch (err) {
      console.warn('[KlausAuth] Server logout failed (continuing):', err)
    }
  }
  currentAuth = null
  deleteStoredAuth()
}

/**
 * Refresh user info from the server. Returns null if the token was rejected
 * (401), in which case the caller should treat the user as logged out.
 * Other errors (network) leave state untouched and return the cached user.
 */
export async function refreshMe(): Promise<StoredAuth['user'] | null> {
  if (!currentAuth) return null
  const auth = currentAuth
  try {
    const resp = await fetch(`${SERVER_URL}/api/auth/desktop/me`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    if (resp.status === 401) {
      // Server revoked the token — drop local state
      currentAuth = null
      deleteStoredAuth()
      return null
    }
    if (!resp.ok) return auth.user
    const data = (await resp.json()) as { user: StoredAuth['user'] }
    if (data?.user) {
      currentAuth = { ...auth, user: data.user }
      writeStoredAuth(currentAuth)
      return data.user
    }
    return auth.user
  } catch (err) {
    console.warn('[KlausAuth] refreshMe network error:', err)
    return auth.user
  }
}
