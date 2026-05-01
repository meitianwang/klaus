/**
 * User persistence: stores users and auth sessions in SQLite (~/.klaus/users.db).
 *
 * - Email + scrypt password authentication
 * - Google OAuth support (googleId field)
 * - Session token based auth (HttpOnly cookie)
 * - First registered user automatically becomes admin
 * - Invite code required for registration
 *
 * Layering: SQL for the `users` table is delegated to `UsersRepo`
 * (src/db/repos/users.ts). This file remains the service layer for
 * password hashing, brute-force lockout policy, email normalization,
 * invite-code rules, plus the auth_sessions / desktop_* tables (those
 * still own their SQL inline pending follow-up repo extraction).
 */

import { Database } from "bun:sqlite";
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import { UsersRepo, type UserRow } from "./db/repos/users.js";
import { AuthSessionsRepo } from "./db/repos/auth-sessions.js";
import { DesktopAuthRepo } from "./db/repos/desktop-auth.js";

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
// Schema
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL DEFAULT '',
    display_name    TEXT NOT NULL DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'user',
    google_id       TEXT UNIQUE,
    invite_code     TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    last_login_at   INTEGER NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

  -- Desktop OAuth-style authorization codes (one-time, 5-min TTL)
  CREATE TABLE IF NOT EXISTS desktop_auth_codes (
    code            TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state           TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    used_at         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_desktop_auth_codes_expires ON desktop_auth_codes(expires_at);

  -- Desktop long-lived bearer tokens
  CREATE TABLE IF NOT EXISTS desktop_tokens (
    token         TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER NOT NULL,
    device_info   TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_desktop_tokens_user_id ON desktop_tokens(user_id);
`;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip: string;
  user_agent: string;
}

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

function rowToSession(row: SessionRow): AuthSession {
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
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// UserStore
// ---------------------------------------------------------------------------

export class UserStore {
  private readonly db: Database;
  private readonly users: UsersRepo;
  private readonly authSessions: AuthSessionsRepo;
  private readonly desktopAuth: DesktopAuthRepo;

  private readonly sessionMaxAgeMs: number;

  constructor(dbPath?: string, sessionMaxAgeMs?: number) {
    const resolvedPath = dbPath ?? join(CONFIG_DIR, "users.db");
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(INIT_SQL);

    this.sessionMaxAgeMs = sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;

    // Run migrations BEFORE constructing the repo (its prepared statements
    // reference these columns, and prepare-time validation fails if missing).
    try {
      this.db.exec(
        "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        "ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0",
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
    } catch {
      /* column already exists */
    }

    this.users = new UsersRepo(this.db);
    this.authSessions = new AuthSessionsRepo(this.db);
    this.desktopAuth = new DesktopAuthRepo(this.db);

    // Best-effort file permissions
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      /* ignore */
    }
  }

  // -- User registration ----------------------------------------------------

  /** Returns true if no users exist yet (first user becomes admin). */
  isFirstUser(): boolean {
    return this.users.count() === 0;
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

    // Transaction to prevent TOCTOU race on isFirstUser check
    this.db.transaction(() => {
      const isFirst = this.users.count() === 0;
      // Re-check invite code inside transaction to prevent race condition
      if (!isFirst && !inviteCode) {
        throw new Error("invite_code_required");
      }
      this.users.insert({
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
    })();

    return this.getUserById(id)!;
  }

  /** Register or login via Google OAuth. */
  async findOrCreateByGoogle(
    googleId: string,
    email: string,
    displayName: string,
    inviteCode?: string,
  ): Promise<{ user: User; isNew: boolean }> {
    // Check if user exists by googleId
    const byGoogle = this.users.findByGoogleId(googleId);
    if (byGoogle) {
      const now = Date.now();
      this.users.updateLastLogin(byGoogle.id, now);
      return {
        user: rowToUser({ ...byGoogle, last_login_at: now }),
        isNew: false,
      };
    }

    // Check if user exists by email (link Google account)
    const byEmail = this.users.findByEmail(email.toLowerCase().trim());
    if (byEmail) {
      const now = Date.now();
      this.users.linkGoogle(byEmail.id, googleId);
      this.users.updateLastLogin(byEmail.id, now);
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
    const isFirst = this.users.count() === 0;
    if (!isFirst && !inviteCode) {
      throw new Error("invite_code_required");
    }

    const now = Date.now();
    const id = randomBytes(16).toString("hex");

    // Transaction to prevent TOCTOU race on isFirstUser check
    this.db.transaction(() => {
      const isFirstInTx = this.users.count() === 0;
      // Re-check invite code inside transaction to prevent race condition
      if (!isFirstInTx && !inviteCode) {
        throw new Error("invite_code_required");
      }
      this.users.insert({
        id,
        email: email.toLowerCase().trim(),
        passwordHash: "", // No password for Google-only users
        displayName: displayName.trim(),
        role: isFirstInTx ? "admin" : "user",
        googleId,
        inviteCode: inviteCode ?? "",
        createdAt: now,
        lastLoginAt: now,
        isActive: 1,
      });
    })();

    return { user: this.getUserById(id)!, isNew: true };
  }

  // -- User login -----------------------------------------------------------

  /** Verify email + password. Returns user if valid, null otherwise. */
  async verifyLogin(email: string, password: string): Promise<User | null> {
    const row = this.users.findByEmail(email.toLowerCase().trim());
    if (!row) return null;
    if (!row.is_active) return null;
    if (!row.password_hash) return null; // Google-only user

    // Check account lockout
    const now = Date.now();
    if (row.locked_until > now) return null;

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      this.users.incrFailedAttempts(row.id);
      if ((row.failed_attempts ?? 0) + 1 >= MAX_FAILED_ATTEMPTS) {
        this.users.lockUser(row.id, now + LOCKOUT_DURATION_MS);
      }
      return null;
    }

    // Successful login — reset counters
    this.users.resetFailedAttempts(row.id);
    this.users.updateLastLogin(row.id, now);
    return rowToUser({ ...row, last_login_at: now });
  }

  // -- User queries ---------------------------------------------------------

  getUserById(id: string): User | undefined {
    const row = this.users.findById(id);
    return row ? rowToUser(row) : undefined;
  }

  getUserByEmail(email: string): User | undefined {
    const row = this.users.findByEmail(email.toLowerCase().trim());
    return row ? rowToUser(row) : undefined;
  }

  listUsers(): readonly User[] {
    return this.users.list().map(rowToUser);
  }

  // -- User management (admin) ----------------------------------------------

  setActive(userId: string, active: boolean): boolean {
    return this.users.setActive(userId, active);
  }

  setRole(userId: string, role: "admin" | "user"): boolean {
    return this.users.setRole(userId, role);
  }

  setDisplayName(userId: string, displayName: string): boolean {
    return this.users.setDisplayName(userId, displayName);
  }

  setAvatarUrl(userId: string, avatarUrl: string | null): boolean {
    return this.users.setAvatarUrl(userId, avatarUrl);
  }

  // -- Auth sessions --------------------------------------------------------

  /** Create a new auth session. Returns the session. */
  createSession(userId: string, ip: string, userAgent: string): AuthSession {
    const token = randomBytes(32).toString("hex"); // 64 hex chars
    const now = Date.now();
    const expiresAt = now + this.sessionMaxAgeMs;
    const truncatedUa = userAgent.slice(0, 500);

    this.authSessions.insert({
      token,
      userId,
      createdAt: now,
      expiresAt,
      ip,
      userAgent: truncatedUa,
    });

    return { token, userId, createdAt: now, expiresAt, ip, userAgent };
  }

  /** Validate a session token. Returns user + session if valid. */
  validateSession(token: string): { user: User; session: AuthSession } | null {
    if (!token) return null;

    const row = this.authSessions.findByToken(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.authSessions.delete(token);
      return null;
    }

    const session = rowToSession(row);
    const user = this.getUserById(session.userId);
    if (!user || !user.isActive) {
      this.authSessions.delete(token);
      return null;
    }

    return { user, session };
  }

  /** Revoke a single session. */
  revokeSession(token: string): boolean {
    return this.authSessions.delete(token);
  }

  /** Revoke all sessions for a user. */
  revokeAllSessions(userId: string): number {
    return this.authSessions.deleteByUser(userId);
  }

  /** Remove expired sessions. */
  pruneExpiredSessions(): number {
    return this.authSessions.pruneExpired(Date.now());
  }

  // -- Desktop auth: authorization codes ------------------------------------

  /**
   * Issue a one-time authorization code for the desktop app after successful
   * web login. `codeChallenge` is the SHA-256-hashed PKCE challenge from the
   * desktop client. The returned code is redeemed via `redeemDesktopAuthCode`.
   */
  createDesktopAuthCode(
    userId: string,
    state: string,
    codeChallenge: string,
  ): string {
    const code = randomBytes(32).toString("hex");
    const now = Date.now();
    this.desktopAuth.insertCode({
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
  redeemDesktopAuthCode(
    code: string,
    codeVerifier: string,
    deviceInfo: string,
  ): { token: string; user: User } | null {
    const row = this.desktopAuth.findCode(code);
    if (!row) return null;
    if (row.used_at > 0) return null;
    if (row.expires_at < Date.now()) return null;

    // Verify PKCE: base64url(sha256(verifier)) must equal stored challenge
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const computed = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (computed !== row.code_challenge) return null;

    const user = this.getUserById(row.user_id);
    if (!user || !user.isActive) return null;

    // Consume the code (prevents replay) and issue token atomically
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const truncatedDevice = deviceInfo.slice(0, 500);
    this.db.transaction(() => {
      this.desktopAuth.markCodeUsed(code, now);
      this.desktopAuth.insertToken({
        token,
        userId: row.user_id,
        createdAt: now,
        lastUsedAt: now,
        deviceInfo: truncatedDevice,
      });
    })();

    return { token, user };
  }

  /** Resolve a desktop bearer token to its user. Touches last_used_at. */
  validateDesktopToken(token: string): User | null {
    if (!token) return null;
    const userId = this.desktopAuth.findTokenUserId(token);
    if (!userId) return null;
    const user = this.getUserById(userId);
    if (!user || !user.isActive) {
      this.desktopAuth.deleteToken(token);
      return null;
    }
    this.desktopAuth.touchTokenLastUsed(token, Date.now());
    return user;
  }

  revokeDesktopToken(token: string): boolean {
    return this.desktopAuth.deleteToken(token);
  }

  /** Best-effort cleanup for expired/used codes. Called periodically or on startup. */
  pruneExpiredDesktopCodes(): number {
    return this.desktopAuth.pruneCodes(Date.now());
  }

  // -- Lifecycle ------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
