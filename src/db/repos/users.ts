/**
 * UsersRepo — pure data-access layer for the `users` table.
 *
 * Repository pattern: this layer knows only SQL + row shapes.
 * Business rules (password hashing, email normalization, invite-code policy,
 * brute-force lockout thresholds) live in the calling service (UserStore),
 * not here.
 *
 * This is the first repo extracted as part of the Phase 0 schema rework
 * documented in docs/db-migration-plan.md. Other tables (auth_sessions,
 * desktop_auth_codes, desktop_tokens) will follow the same template.
 */

import { Database } from "bun:sqlite";

export interface UserRow {
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
  failed_attempts: number;
  locked_until: number;
}

export interface InsertUserParams {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: string;
  googleId: string | null;
  inviteCode: string;
  createdAt: number;
  lastLoginAt: number;
  isActive: number;
}

export class UsersRepo {
  private readonly stmtFindById;
  private readonly stmtFindByEmail;
  private readonly stmtFindByGoogleId;
  private readonly stmtList;
  private readonly stmtCount;
  private readonly stmtInsert;
  private readonly stmtUpdateLastLogin;
  private readonly stmtSetActive;
  private readonly stmtSetRole;
  private readonly stmtSetDisplayName;
  private readonly stmtSetAvatarUrl;
  private readonly stmtLinkGoogle;
  private readonly stmtIncrFailedAttempts;
  private readonly stmtLockUser;
  private readonly stmtResetFailedAttempts;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtFindById = db.prepare("SELECT * FROM users WHERE id = ?");
    this.stmtFindByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
    this.stmtFindByGoogleId = db.prepare(
      "SELECT * FROM users WHERE google_id = ?",
    );
    this.stmtList = db.prepare(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    this.stmtCount = db.prepare("SELECT COUNT(*) as count FROM users");
    this.stmtInsert = db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, role, google_id, invite_code, created_at, last_login_at, is_active)
      VALUES (@id, @email, @passwordHash, @displayName, @role, @googleId, @inviteCode, @createdAt, @lastLoginAt, @isActive)
    `);
    this.stmtUpdateLastLogin = db.prepare(
      "UPDATE users SET last_login_at = ? WHERE id = ?",
    );
    this.stmtSetActive = db.prepare(
      "UPDATE users SET is_active = ? WHERE id = ?",
    );
    this.stmtSetRole = db.prepare("UPDATE users SET role = ? WHERE id = ?");
    this.stmtSetDisplayName = db.prepare(
      "UPDATE users SET display_name = ? WHERE id = ?",
    );
    this.stmtSetAvatarUrl = db.prepare(
      "UPDATE users SET avatar_url = ? WHERE id = ?",
    );
    this.stmtLinkGoogle = db.prepare(
      "UPDATE users SET google_id = ? WHERE id = ?",
    );
    this.stmtIncrFailedAttempts = db.prepare(
      "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?",
    );
    this.stmtLockUser = db.prepare(
      "UPDATE users SET locked_until = ? WHERE id = ?",
    );
    this.stmtResetFailedAttempts = db.prepare(
      "UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  // -- Reads -----------------------------------------------------------------

  count(): number {
    return (this.stmtCount.get() as { count: number }).count;
  }

  findById(id: string): UserRow | undefined {
    return this.stmtFindById.get(id) as UserRow | undefined;
  }

  /** Caller is responsible for normalizing email (lowercase + trim). */
  findByEmail(email: string): UserRow | undefined {
    return this.stmtFindByEmail.get(email) as UserRow | undefined;
  }

  findByGoogleId(googleId: string): UserRow | undefined {
    return this.stmtFindByGoogleId.get(googleId) as UserRow | undefined;
  }

  list(): readonly UserRow[] {
    return this.stmtList.all() as UserRow[];
  }

  // -- Writes ----------------------------------------------------------------

  insert(params: InsertUserParams): void {
    this.stmtInsert.run({
      "@id": params.id,
      "@email": params.email,
      "@passwordHash": params.passwordHash,
      "@displayName": params.displayName,
      "@role": params.role,
      "@googleId": params.googleId,
      "@inviteCode": params.inviteCode,
      "@createdAt": params.createdAt,
      "@lastLoginAt": params.lastLoginAt,
      "@isActive": params.isActive,
    });
  }

  updateLastLogin(id: string, ts: number): void {
    this.stmtUpdateLastLogin.run(ts, id);
  }

  setActive(id: string, active: boolean): boolean {
    this.stmtSetActive.run(active ? 1 : 0, id);
    return this.lastChanges() > 0;
  }

  setRole(id: string, role: "admin" | "user"): boolean {
    this.stmtSetRole.run(role, id);
    return this.lastChanges() > 0;
  }

  setDisplayName(id: string, displayName: string): boolean {
    this.stmtSetDisplayName.run(displayName, id);
    return this.lastChanges() > 0;
  }

  setAvatarUrl(id: string, avatarUrl: string | null): boolean {
    this.stmtSetAvatarUrl.run(avatarUrl, id);
    return this.lastChanges() > 0;
  }

  linkGoogle(id: string, googleId: string): void {
    this.stmtLinkGoogle.run(googleId, id);
  }

  // -- Brute-force protection -----------------------------------------------

  incrFailedAttempts(id: string): void {
    this.stmtIncrFailedAttempts.run(id);
  }

  lockUser(id: string, until: number): void {
    this.stmtLockUser.run(until, id);
  }

  resetFailedAttempts(id: string): void {
    this.stmtResetFailedAttempts.run(id);
  }

  // -- Internal --------------------------------------------------------------

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
