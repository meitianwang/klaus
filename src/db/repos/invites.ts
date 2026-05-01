/**
 * InvitesRepo — pure data-access layer for the `invite_codes` table.
 *
 * Business rules (random code generation, "consume on success" policy,
 * label sanitization) live in the calling service (InviteStore), not here.
 */

import { Database } from "bun:sqlite";

export interface InviteRow {
  code: string;
  label: string;
  created_at: number;
  is_active: number;
  used_by: string | null;
  used_at: number | null;
}

const SELECT_COLS = "code, label, created_at, is_active, used_by, used_at";

export class InvitesRepo {
  private readonly stmtList;
  private readonly stmtGet;
  private readonly stmtInsert;
  private readonly stmtDelete;
  private readonly stmtConsume;
  private readonly stmtIsValid;
  private readonly stmtChanges;

  constructor(db: Database) {
    this.stmtList = db.prepare(
      `SELECT ${SELECT_COLS} FROM invite_codes ORDER BY created_at DESC`,
    );
    this.stmtGet = db.prepare(
      `SELECT ${SELECT_COLS} FROM invite_codes WHERE code = ?`,
    );
    this.stmtInsert = db.prepare(
      "INSERT INTO invite_codes (code, label, created_at, is_active) VALUES (@code, @label, @createdAt, @isActive)",
    );
    this.stmtDelete = db.prepare("DELETE FROM invite_codes WHERE code = ?");
    this.stmtConsume = db.prepare(
      "UPDATE invite_codes SET is_active = 0, used_by = @usedBy, used_at = @usedAt WHERE code = @code AND is_active = 1",
    );
    this.stmtIsValid = db.prepare(
      "SELECT 1 FROM invite_codes WHERE code = ? AND is_active = 1",
    );
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  list(): readonly InviteRow[] {
    return this.stmtList.all() as InviteRow[];
  }

  get(code: string): InviteRow | undefined {
    return this.stmtGet.get(code) as InviteRow | undefined;
  }

  isValid(code: string): boolean {
    return this.stmtIsValid.get(code) !== undefined;
  }

  insert(params: {
    code: string;
    label: string;
    createdAt: number;
    isActive: number;
  }): void {
    this.stmtInsert.run({
      "@code": params.code,
      "@label": params.label,
      "@createdAt": params.createdAt,
      "@isActive": params.isActive,
    });
  }

  consume(code: string, usedBy: string, usedAt: number): boolean {
    this.stmtConsume.run({ "@code": code, "@usedBy": usedBy, "@usedAt": usedAt });
    return this.lastChanges() > 0;
  }

  delete(code: string): boolean {
    this.stmtDelete.run(code);
    return this.lastChanges() > 0;
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
