/**
 * Invite code persistence: stores invite codes in SQLite (~/.klaus/invites.db)
 * for multi-user access control on the Web channel.
 *
 * Admin creates invite codes via the admin panel; each invite code acts as
 * a scoped token — users with an invite code can only see their own sessions.
 *
 * Layering: SQL is delegated to InvitesRepo (src/db/repos/invites.ts).
 * This file owns business policy (random code generation, label sanitization,
 * "consume = mark used" semantics, schema migrations).
 */

import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import { InvitesRepo, type InviteRow } from "./db/repos/invites.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InviteCode {
  readonly code: string;
  readonly label: string;
  readonly createdAt: number;
  readonly isActive: boolean;
  readonly usedBy: string | null;
  readonly usedAt: number | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    used_by     TEXT,
    used_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_invite_codes_active
    ON invite_codes(is_active);
`;

const MIGRATE_SQL = `
  ALTER TABLE invite_codes ADD COLUMN used_by TEXT;
  ALTER TABLE invite_codes ADD COLUMN used_at INTEGER;
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToInviteCode(row: InviteRow): InviteCode {
  return {
    code: row.code,
    label: row.label,
    createdAt: row.created_at,
    isActive: row.is_active === 1,
    usedBy: row.used_by,
    usedAt: row.used_at,
  };
}

// ---------------------------------------------------------------------------
// InviteStore
// ---------------------------------------------------------------------------

export class InviteStore {
  private readonly db: Database;
  private readonly invites: InvitesRepo;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? join(CONFIG_DIR, "invites.db");
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(INIT_SQL);

    // Migrate: add used_by/used_at columns if missing (must run before repo prepares stmts)
    const cols = this.db.prepare("PRAGMA table_info(invite_codes)").all() as {
      name: string;
    }[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("used_by")) {
      try {
        this.db.exec(MIGRATE_SQL);
      } catch {
        // columns may already exist from partial migration
      }
    }

    this.invites = new InvitesRepo(this.db);
  }

  /** List all invite codes (newest first). */
  list(): readonly InviteCode[] {
    return this.invites.list().map(rowToInviteCode);
  }

  /** Get a single invite code by code string. */
  get(code: string): InviteCode | undefined {
    const row = this.invites.get(code);
    return row ? rowToInviteCode(row) : undefined;
  }

  /** Check if a code is a valid (existing + active) invite code. */
  isValid(code: string): boolean {
    return this.invites.isValid(code);
  }

  /** Create a new invite code. Returns the created InviteCode. */
  create(label: string = ""): InviteCode {
    const code = randomBytes(16).toString("hex"); // 32 hex chars
    const createdAt = Date.now();
    this.invites.insert({ code, label, createdAt, isActive: 1 });
    return {
      code,
      label,
      createdAt,
      isActive: true,
      usedBy: null,
      usedAt: null,
    };
  }

  /** Mark an invite code as consumed. Records who used it and when. */
  consume(code: string, usedBy: string): boolean {
    return this.invites.consume(code, usedBy, Date.now());
  }

  /** Delete an invite code permanently. Returns true if deleted. */
  delete(code: string): boolean {
    return this.invites.delete(code);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
