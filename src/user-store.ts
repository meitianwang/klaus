/**
 * User persistence — delegates to Postgres repos.
 *
 * - Email + scrypt password authentication
 * - Google OAuth support (googleId field)
 * - Session token based auth (HttpOnly cookie)
 * - First registered user automatically becomes admin
 * - Invite code required for registration
 *
 * All methods are async (PG repos are async). Callers must add `await`.
 */

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from "node:crypto";
import type { Db } from "./db/connection.js";
import { getDb } from "./db/connection.js";
import { UsersRepoPg, type UserRow } from "./db/repos/users.pg.js";
import { AuthSessionsRepoPg } from "./db/repos/auth-sessions.pg.js";
import { DesktopAuthRepoPg } from "./db/repos/desktop-auth.pg.js";

function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, derivedKey: Buffer) => {
      if (err) reject(err);
      else resolve(derivedKey);
    };
    if (options) {
      scrypt(password, salt, keylen, options, cb);
    } else {
      scrypt(password, salt, keylen, cb);
    }
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "admin" | "user";
  readonly avatarUrl: string | null;
  readonly googleId: string | null;
  readonly inviteCode: string;
  readonly createdAt: number;
  readonly lastLoginAt: number;
  readonly isActive: boolean;
}

interface AuthSession {
  readonly token: string;
  readonly userId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly ip: string;
  readonly userAgent: string;
}

// ---------------------------------------------------------------------------
// Password hashing (Node.js built-in scrypt, no external deps)
// ---------------------------------------------------------------------------

// OWASP-recommended scrypt parameters
const SCRYPT_OPTS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(
    password,
    salt,
    64,
    SCRYPT_OPTS,
  )) as Buffer;
  return salt + ":" + derived.toString("hex");
}

async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(
    password,
    salt,
    64,
    SCRYPT_OPTS,
  )) as Buffer;
  return timingSafeEqual(Buffer.from(key, "hex"), derived);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as "admin" | "user",
    avatarUrl: row.avatar_url,
    googleId: row.google_id,
    inviteCode: row.invite_code,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    isActive: row.is_active === 1,
  };
}

function rowToSession(row: {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip: string;
  user_agent: string;
}): AuthSession {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

// ---------------------------------------------------------------------------
// UserStore
// ---------------------------------------------------------------------------

export class UserStore {
  private readonly users: UsersRepoPg;
  private readonly authSessions: AuthSessionsRepoPg;
  private readonly desktopAuth: DesktopAuthRepoPg;
  private readonly sessionMaxAgeMs: number;

  constructor(db?: Db | string, sessionMaxAgeMs?: number) {
    // Accept legacy (dbPath?: string, sessionMaxAgeMs?: number) signature:
    // If first arg is a string (old dbPath), ignore it — PG uses DATABASE_URL.
    const resolvedDb = (db == null || typeof db === "string") ? getDb() : db;
    this.sessionMaxAgeMs = sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;
    this.users = new UsersRepoPg(resolvedDb);
    this.authSessions = new AuthSessionsRepoPg(resolvedDb);
    this.desktopAuth = new DesktopAuthRepoPg(resolvedDb);
  }

  // -- User registration ----------------------------------------------------

  /** Returns true if no users exist yet (first user becomes admin). */
  async isFirstUser(): Promise<boolean> {
    return (await this.users.count()) === 0;
  }

  /** Register a new user. Returns the created user. */
  async register(
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ): Promise<User> {
    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const id = randomBytes(16).toString("hex");

    const isFirst = await this.users.count() === 0;
    if (!isFirst && !inviteCode) {
      throw new Error("invite_code_required");
    }

    await this.users.insert({
      id,
      email: email.toLowerCase().trim(),
      passwordHash,
      displayName: displayName.trim(),
      role: isFirst ? "admin" : "user",
      googleId: null,
      inviteCode,
      createdAt: now,
      lastLoginAt: now,
      isActive: 1,
    });

    return rowToUser((await this.users.findById(id))!);
  }

  /** Register or login via Google OAuth. */
  async findOrCreateByGoogle(
    googleId: string,
    email: string,
    displayName: string,
    inviteCode?: string,
  ): Promise<{ user: User; isNew: boolean }> {
    // Check if user exists by googleId
    const byGoogle = await this.users.findByGoogleId(googleId);
    if (byGoogle) {
      const now = Date.now();
      await this.users.updateLastLogin(byGoogle.id, now);
      return {
        user: rowToUser({ ...byGoogle, last_login_at: now }),
        isNew: false,
      };
    }

    // Check if user exists by email (link Google account)
    const byEmail = await this.users.findByEmail(email.toLowerCase().trim());
    if (byEmail) {
      const now = Date.now();
      await this.users.linkGoogle(byEmail.id, googleId);
      await this.users.updateLastLogin(byEmail.id, now);
      return {
        user: rowToUser({
          ...byEmail,
          google_id: googleId,
          last_login_at: now,
        }),
        isNew: false,
      };
    }

    // New user — requires invite code (unless first user)
    const isFirst = (await this.users.count()) === 0;
    if (!isFirst && !inviteCode) {
      throw new Error("invite_code_required");
    }

    const now = Date.now();
    const id = randomBytes(16).toString("hex");

    await this.users.insert({
      id,
      email: email.toLowerCase().trim(),
      passwordHash: "", // No password for Google-only users
      displayName: displayName.trim(),
      role: isFirst ? "admin" : "user",
      googleId,
      inviteCode: inviteCode ?? "",
      createdAt: now,
      lastLoginAt: now,
      isActive: 1,
    });

    return { user: rowToUser((await this.users.findById(id))!), isNew: true };
  }

  // -- User login -----------------------------------------------------------

  /** Verify email + password. Returns user if valid, null otherwise. */
  async verifyLogin(email: string, password: string): Promise<User | null> {
    const row = await this.users.findByEmail(email.toLowerCase().trim());
    if (!row) return null;
    if (!row.is_active) return null;
    if (!row.password_hash) return null; // Google-only user

    // Check account lockout
    const now = Date.now();
    if (row.locked_until > now) return null;

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      await this.users.incrFailedAttempts(row.id);
      if ((row.failed_attempts ?? 0) + 1 >= MAX_FAILED_ATTEMPTS) {
        await this.users.lockUser(row.id, now + LOCKOUT_DURATION_MS);
      }
      return null;
    }

    // Successful login — reset counters
    await this.users.resetFailedAttempts(row.id);
    await this.users.updateLastLogin(row.id, now);
    return rowToUser({ ...row, last_login_at: now });
  }

  // -- User queries ---------------------------------------------------------

  async getUserById(id: string): Promise<User | undefined> {
    const row = await this.users.findById(id);
    return row ? rowToUser(row) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const row = await this.users.findByEmail(email.toLowerCase().trim());
    return row ? rowToUser(row) : undefined;
  }

  async listUsers(): Promise<readonly User[]> {
    return (await this.users.list()).map(rowToUser);
  }

  // -- User management (admin) ----------------------------------------------

  async setActive(userId: string, active: boolean): Promise<boolean> {
    return this.users.setActive(userId, active);
  }

  async setRole(userId: string, role: "admin" | "user"): Promise<boolean> {
    return this.users.setRole(userId, role);
  }

  async setDisplayName(userId: string, displayName: string): Promise<boolean> {
    return this.users.setDisplayName(userId, displayName);
  }

  async setAvatarUrl(userId: string, avatarUrl: string | null): Promise<boolean> {
    return this.users.setAvatarUrl(userId, avatarUrl);
  }

  // -- Auth sessions --------------------------------------------------------

  /** Create a new auth session. Returns the session. */
  async createSession(userId: string, ip: string, userAgent: string): Promise<AuthSession> {
    const token = randomBytes(32).toString("hex"); // 64 hex chars
    const now = Date.now();
    const expiresAt = now + this.sessionMaxAgeMs;
    const truncatedUa = userAgent.slice(0, 500);

    await this.authSessions.insert({
      token,
      userId,
      createdAt: now,
      expiresAt,
      ip,
      userAgent: truncatedUa,
    });

    return { token, userId, createdAt: now, expiresAt, ip, userAgent: truncatedUa };
  }

  /** Validate a session token. Returns user + session if valid. */
  async validateSession(token: string): Promise<{ user: User; session: AuthSession } | null> {
    if (!token) return null;

    const row = await this.authSessions.findByToken(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      await this.authSessions.delete(token);
      return null;
    }

    const session = rowToSession(row);
    const user = await this.getUserById(session.userId);
    if (!user || !user.isActive) {
      await this.authSessions.delete(token);
      return null;
    }

    return { user, session };
  }

  /** Revoke a single session. */
  async revokeSession(token: string): Promise<boolean> {
    return this.authSessions.delete(token);
  }

  /** Revoke all sessions for a user. */
  async revokeAllSessions(userId: string): Promise<number> {
    return this.authSessions.deleteByUser(userId);
  }

  /** Remove expired sessions. */
  async pruneExpiredSessions(): Promise<number> {
    return this.authSessions.pruneExpired(Date.now());
  }

  // -- Desktop auth: authorization codes ------------------------------------

  /**
   * Issue a one-time authorization code for the desktop app after successful
   * web login. `codeChallenge` is the SHA-256-hashed PKCE challenge from the
   * desktop client. The returned code is redeemed via `redeemDesktopAuthCode`.
   */
  async createDesktopAuthCode(
    userId: string,
    state: string,
    codeChallenge: string,
  ): Promise<string> {
    const code = randomBytes(32).toString("hex");
    const now = Date.now();
    await this.desktopAuth.insertCode({
      code,
      userId,
      state,
      codeChallenge,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    });
    return code;
  }

  /**
   * Exchange an authorization code + PKCE verifier for a long-lived desktop
   * bearer token. Returns null on any failure (unknown code, expired, reused,
   * or verifier mismatch). The code is consumed on success.
   */
  async redeemDesktopAuthCode(
    code: string,
    codeVerifier: string,
    deviceInfo: string,
  ): Promise<{ token: string; user: User } | null> {
    const row = await this.desktopAuth.findCode(code);
    if (!row) return null;
    if (row.used_at > 0) return null;
    if (row.expires_at < Date.now()) return null;

    // Verify PKCE: base64url(sha256(verifier)) must equal stored challenge
    const computed = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (computed !== row.code_challenge) return null;

    const user = await this.getUserById(row.user_id);
    if (!user || !user.isActive) return null;

    // Consume the code (prevents replay) and issue token
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const truncatedDevice = deviceInfo.slice(0, 500);
    await this.desktopAuth.markCodeUsed(code, now);
    await this.desktopAuth.insertToken({
      token,
      userId: row.user_id,
      createdAt: now,
      lastUsedAt: now,
      deviceInfo: truncatedDevice,
    });

    return { token, user };
  }

  /** Resolve a desktop bearer token to its user. Touches last_used_at. */
  async validateDesktopToken(token: string): Promise<User | null> {
    if (!token) return null;
    const userId = await this.desktopAuth.findTokenUserId(token);
    if (!userId) return null;
    const user = await this.getUserById(userId);
    if (!user || !user.isActive) {
      await this.desktopAuth.deleteToken(token);
      return null;
    }
    await this.desktopAuth.touchTokenLastUsed(token, Date.now());
    return user;
  }

  async revokeDesktopToken(token: string): Promise<boolean> {
    return this.desktopAuth.deleteToken(token);
  }

  /** Best-effort cleanup for expired/used codes. Called periodically or on startup. */
  async pruneExpiredDesktopCodes(): Promise<number> {
    return this.desktopAuth.pruneCodes(Date.now());
  }

  // -- Lifecycle ------------------------------------------------------------

  /** No-op — PG pool is managed globally. */
  close(): void {
    // PG pool lifecycle is managed by getDb() singleton; nothing to close here.
  }
}
