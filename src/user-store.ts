/**
 * User persistence: stores users and auth sessions in SQLite (~/.klaus/users.db).
 *
 * - Email + scrypt password authentication
 * - Google OAuth support (googleId field)
 * - Session token based auth (HttpOnly cookie)
 * - First registered user automatically becomes admin
 * - Invite code required for registration
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

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  avatar_url: string | null;
  google_id: string | null;
  invite_code: string;
  created_at: number;
  last_login_at: number;
  is_active: number;
}

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

  // Pre-compiled statements
  private readonly stmtGetUserById: ReturnType<Database["prepare"]>;
  private readonly stmtGetUserByEmail: ReturnType<Database["prepare"]>;
  private readonly stmtGetUserByGoogleId: ReturnType<Database["prepare"]>;
  private readonly stmtInsertUser: ReturnType<Database["prepare"]>;
  private readonly stmtUpdateLastLogin: ReturnType<Database["prepare"]>;
  private readonly stmtSetActive: ReturnType<Database["prepare"]>;
  private readonly stmtSetRole: ReturnType<Database["prepare"]>;
  private readonly stmtSetDisplayName: ReturnType<Database["prepare"]>;
  private readonly stmtSetAvatarUrl: ReturnType<Database["prepare"]>;
  private readonly stmtLinkGoogle: ReturnType<Database["prepare"]>;
  private readonly stmtListUsers: ReturnType<Database["prepare"]>;
  private readonly stmtCountUsers: ReturnType<Database["prepare"]>;

  private readonly stmtInsertSession: ReturnType<Database["prepare"]>;
  private readonly stmtGetSession: ReturnType<Database["prepare"]>;
  private readonly stmtDeleteSession: ReturnType<Database["prepare"]>;
  private readonly stmtDeleteUserSessions: ReturnType<Database["prepare"]>;
  private readonly stmtPruneSessions: ReturnType<Database["prepare"]>;
  private readonly stmtIncrFailedAttempts: ReturnType<Database["prepare"]>;
  private readonly stmtLockUser: ReturnType<Database["prepare"]>;
  private readonly stmtResetFailedAttempts: ReturnType<Database["prepare"]>;

  private readonly sessionMaxAgeMs: number;

  constructor(dbPath?: string, sessionMaxAgeMs?: number) {
    const resolvedPath = dbPath ?? join(CONFIG_DIR, "users.db");
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(INIT_SQL);

    this.sessionMaxAgeMs = sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;

    // Run migrations BEFORE preparing statements (columns must exist first)
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

    // User statements
    this.stmtGetUserById = this.db.prepare("SELECT * FROM users WHERE id = ?");
    this.stmtGetUserByEmail = this.db.prepare(
      "SELECT * FROM users WHERE email = ?",
    );
    this.stmtGetUserByGoogleId = this.db.prepare(
      "SELECT * FROM users WHERE google_id = ?",
    );
    this.stmtInsertUser = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, role, google_id, invite_code, created_at, last_login_at, is_active)
      VALUES (@id, @email, @passwordHash, @displayName, @role, @googleId, @inviteCode, @createdAt, @lastLoginAt, @isActive)
    `);
    this.stmtUpdateLastLogin = this.db.prepare(
      "UPDATE users SET last_login_at = ? WHERE id = ?",
    );
    this.stmtSetActive = this.db.prepare(
      "UPDATE users SET is_active = ? WHERE id = ?",
    );
    this.stmtSetRole = this.db.prepare(
      "UPDATE users SET role = ? WHERE id = ?",
    );
    this.stmtSetDisplayName = this.db.prepare(
      "UPDATE users SET display_name = ? WHERE id = ?",
    );
    this.stmtSetAvatarUrl = this.db.prepare(
      "UPDATE users SET avatar_url = ? WHERE id = ?",
    );
    this.stmtLinkGoogle = this.db.prepare(
      "UPDATE users SET google_id = ? WHERE id = ?",
    );
    this.stmtListUsers = this.db.prepare(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    this.stmtCountUsers = this.db.prepare(
      "SELECT COUNT(*) as count FROM users",
    );

    // Session statements
    this.stmtInsertSession = this.db.prepare(`
      INSERT INTO auth_sessions (token, user_id, created_at, expires_at, ip, user_agent)
      VALUES (@token, @userId, @createdAt, @expiresAt, @ip, @userAgent)
    `);
    this.stmtGetSession = this.db.prepare(
      "SELECT * FROM auth_sessions WHERE token = ?",
    );
    this.stmtDeleteSession = this.db.prepare(
      "DELETE FROM auth_sessions WHERE token = ?",
    );
    this.stmtDeleteUserSessions = this.db.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ?",
    );
    this.stmtPruneSessions = this.db.prepare(
      "DELETE FROM auth_sessions WHERE expires_at < ?",
    );

    // Brute-force protection statements
    this.stmtIncrFailedAttempts = this.db.prepare(
      "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?",
    );
    this.stmtLockUser = this.db.prepare(
      "UPDATE users SET locked_until = ? WHERE id = ?",
    );
    this.stmtResetFailedAttempts = this.db.prepare(
      "UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?",
    );

    // Best-effort file permissions
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      /* ignore */
    }
  }

  /** Number of rows changed by the last INSERT/UPDATE/DELETE. */
  private lastChanges(): number {
    return (this.db.prepare("SELECT changes() as c").get() as any)?.c ?? 0;
  }

  // -- User registration ----------------------------------------------------

  /** Returns true if no users exist yet (first user becomes admin). */
  isFirstUser(): boolean {
    const row = this.stmtCountUsers.get() as { count: number };
    return row.count === 0;
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
    const insertUser = this.db.transaction(() => {
      const isFirst = this.isFirstUser();
      // Re-check invite code inside transaction to prevent race condition
      if (!isFirst && !inviteCode) {
        throw new Error("invite_code_required");
      }
      this.stmtInsertUser.run({
        "@id": id,
        "@email": email.toLowerCase().trim(),
        "@passwordHash": passwordHash,
        "@displayName": displayName.trim(),
        "@role": isFirst ? "admin" : "user",
        "@googleId": null,
        "@inviteCode": inviteCode,
        "@createdAt": now,
        "@lastLoginAt": now,
        "@isActive": 1,
      });
    });
    insertUser();

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
    const byGoogle = this.stmtGetUserByGoogleId.get(googleId) as
      | UserRow
      | undefined;
    if (byGoogle) {
      this.stmtUpdateLastLogin.run(Date.now(), byGoogle.id);
      return {
        user: rowToUser({ ...byGoogle, last_login_at: Date.now() }),
        isNew: false,
      };
    }

    // Check if user exists by email (link Google account)
    const byEmail = this.stmtGetUserByEmail.get(email.toLowerCase().trim()) as
      | UserRow
      | undefined;
    if (byEmail) {
      this.stmtLinkGoogle.run(googleId, byEmail.id);
      this.stmtUpdateLastLogin.run(Date.now(), byEmail.id);
      return {
        user: rowToUser({
          ...byEmail,
          google_id: googleId,
          last_login_at: Date.now(),
        }),
        isNew: false,
      };
    }

    // New user — requires invite code (unless first user)
    const isFirst = this.isFirstUser();
    if (!isFirst && !inviteCode) {
      throw new Error("invite_code_required");
    }

    const now = Date.now();
    const id = randomBytes(16).toString("hex");

    // Transaction to prevent TOCTOU race on isFirstUser check
    const insertUser = this.db.transaction(() => {
      const isFirst = this.isFirstUser();
      // Re-check invite code inside transaction to prevent race condition
      if (!isFirst && !inviteCode) {
        throw new Error("invite_code_required");
      }
      this.stmtInsertUser.run({
        "@id": id,
        "@email": email.toLowerCase().trim(),
        "@passwordHash": "", // No password for Google-only users
        "@displayName": displayName.trim(),
        "@role": isFirst ? "admin" : "user",
        "@googleId": googleId,
        "@inviteCode": inviteCode ?? "",
        "@createdAt": now,
        "@lastLoginAt": now,
        "@isActive": 1,
      });
    });
    insertUser();

    return { user: this.getUserById(id)!, isNew: true };
  }

  // -- User login -----------------------------------------------------------

  /** Verify email + password. Returns user if valid, null otherwise. */
  async verifyLogin(email: string, password: string): Promise<User | null> {
    const row = this.stmtGetUserByEmail.get(email.toLowerCase().trim()) as
      | (UserRow & { failed_attempts: number; locked_until: number })
      | undefined;
    if (!row) return null;
    if (!row.is_active) return null;
    if (!row.password_hash) return null; // Google-only user

    // Check account lockout
    const now = Date.now();
    if (row.locked_until > now) return null;

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      this.stmtIncrFailedAttempts.run(row.id);
      if ((row.failed_attempts ?? 0) + 1 >= MAX_FAILED_ATTEMPTS) {
        this.stmtLockUser.run(now + LOCKOUT_DURATION_MS, row.id);
      }
      return null;
    }

    // Successful login — reset counters
    this.stmtResetFailedAttempts.run(row.id);
    this.stmtUpdateLastLogin.run(now, row.id);
    return rowToUser({ ...row, last_login_at: now });
  }

  // -- User queries ---------------------------------------------------------

  getUserById(id: string): User | undefined {
    const row = this.stmtGetUserById.get(id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getUserByEmail(email: string): User | undefined {
    const row = this.stmtGetUserByEmail.get(email.toLowerCase().trim()) as
      | UserRow
      | undefined;
    return row ? rowToUser(row) : undefined;
  }

  listUsers(): readonly User[] {
    return (this.stmtListUsers.all() as UserRow[]).map(rowToUser);
  }

  // -- User management (admin) ----------------------------------------------

  setActive(userId: string, active: boolean): boolean {
    this.stmtSetActive.run(active ? 1 : 0, userId);
    return this.lastChanges() > 0;
  }

  setRole(userId: string, role: "admin" | "user"): boolean {
    this.stmtSetRole.run(role, userId);
    return this.lastChanges() > 0;
  }

  setDisplayName(userId: string, displayName: string): boolean {
    this.stmtSetDisplayName.run(displayName, userId);
    return this.lastChanges() > 0;
  }

  setAvatarUrl(userId: string, avatarUrl: string | null): boolean {
    this.stmtSetAvatarUrl.run(avatarUrl, userId);
    return this.lastChanges() > 0;
  }

  // -- Auth sessions --------------------------------------------------------

  /** Create a new auth session. Returns the session. */
  createSession(userId: string, ip: string, userAgent: string): AuthSession {
    const token = randomBytes(32).toString("hex"); // 64 hex chars
    const now = Date.now();
    const expiresAt = now + this.sessionMaxAgeMs;

    this.stmtInsertSession.run({
      "@token": token,
      "@userId": userId,
      "@createdAt": now,
      "@expiresAt": expiresAt,
      "@ip": ip,
      "@userAgent": userAgent.slice(0, 500),
    });

    return { token, userId, createdAt: now, expiresAt, ip, userAgent };
  }

  /** Validate a session token. Returns user + session if valid. */
  validateSession(token: string): { user: User; session: AuthSession } | null {
    if (!token) return null;

    const row = this.stmtGetSession.get(token) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.stmtDeleteSession.run(token);
      return null;
    }

    const session = rowToSession(row);
    const user = this.getUserById(session.userId);
    if (!user || !user.isActive) {
      this.stmtDeleteSession.run(token);
      return null;
    }

    return { user, session };
  }

  /** Revoke a single session. */
  revokeSession(token: string): boolean {
    this.stmtDeleteSession.run(token);
    return this.lastChanges() > 0;
  }

  /** Revoke all sessions for a user. */
  revokeAllSessions(userId: string): number {
    this.stmtDeleteUserSessions.run(userId);
    return this.lastChanges();
  }

  /** Remove expired sessions. */
  pruneExpiredSessions(): number {
    this.stmtPruneSessions.run(Date.now());
    return this.lastChanges();
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
    this.db
      .prepare(
        `INSERT INTO desktop_auth_codes (code, user_id, state, code_challenge, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, userId, state, codeChallenge, now, now + 5 * 60 * 1000);
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
    const row = this.db
      .prepare(
        `SELECT * FROM desktop_auth_codes WHERE code = ?`,
      )
      .get(code) as
      | {
          code: string;
          user_id: string;
          state: string;
          code_challenge: string;
          created_at: number;
          expires_at: number;
          used_at: number;
        }
      | undefined;
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
    const txn = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE desktop_auth_codes SET used_at = ? WHERE code = ?`)
        .run(now, code);
      this.db
        .prepare(
          `INSERT INTO desktop_tokens (token, user_id, created_at, last_used_at, device_info)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(token, row.user_id, now, now, deviceInfo.slice(0, 500));
    });
    txn();

    return { token, user };
  }

  /** Resolve a desktop bearer token to its user. Touches last_used_at. */
  validateDesktopToken(token: string): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT user_id FROM desktop_tokens WHERE token = ?`)
      .get(token) as { user_id: string } | undefined;
    if (!row) return null;
    const user = this.getUserById(row.user_id);
    if (!user || !user.isActive) {
      this.db.prepare(`DELETE FROM desktop_tokens WHERE token = ?`).run(token);
      return null;
    }
    this.db
      .prepare(`UPDATE desktop_tokens SET last_used_at = ? WHERE token = ?`)
      .run(Date.now(), token);
    return user;
  }

  revokeDesktopToken(token: string): boolean {
    this.db.prepare(`DELETE FROM desktop_tokens WHERE token = ?`).run(token);
    return this.lastChanges() > 0;
  }

  /** Best-effort cleanup for expired/used codes. Called periodically or on startup. */
  pruneExpiredDesktopCodes(): number {
    this.db
      .prepare(
        `DELETE FROM desktop_auth_codes WHERE expires_at < ? OR used_at > 0`,
      )
      .run(Date.now());
    return this.lastChanges();
  }

  // -- Lifecycle ------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
