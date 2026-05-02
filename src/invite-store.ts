/**
 * Invite code persistence — delegates to InvitesRepoPg (Postgres).
 *
 * All methods are async to match the PG repo's async interface.
 * Callers that previously called sync methods must add `await`.
 */

import { randomBytes } from "node:crypto";
import type { Db } from "./db/connection.js";
import { getDb } from "./db/connection.js";
import { InvitesRepoPg, type InviteRow } from "./db/repos/invites.pg.js";

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
  private readonly invites: InvitesRepoPg;

  constructor(db?: Db) {
    this.invites = new InvitesRepoPg(db ?? getDb());
  }

  /** List all invite codes (newest first). */
  async list(): Promise<readonly InviteCode[]> {
    const rows = await this.invites.list();
    return rows.map(rowToInviteCode);
  }

  /** Get a single invite code by code string. */
  async get(code: string): Promise<InviteCode | undefined> {
    const row = await this.invites.get(code);
    return row ? rowToInviteCode(row) : undefined;
  }

  /** Check if a code is a valid (existing + active) invite code. */
  async isValid(code: string): Promise<boolean> {
    return this.invites.isValid(code);
  }

  /** Create a new invite code. Returns the created InviteCode. */
  async create(label: string = ""): Promise<InviteCode> {
    const code = randomBytes(16).toString("hex"); // 32 hex chars
    const createdAt = Date.now();
    await this.invites.insert({ code, label, createdAt, isActive: 1 });
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
  async consume(code: string, usedBy: string): Promise<boolean> {
    return this.invites.consume(code, usedBy, Date.now());
  }

  /** Delete an invite code permanently. Returns true if deleted. */
  async delete(code: string): Promise<boolean> {
    return this.invites.delete(code);
  }

  /** No-op — PG pool is managed globally. */
  close(): void {
    // PG pool lifecycle is managed by getDb() singleton; nothing to close here.
  }
}
