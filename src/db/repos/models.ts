/**
 * ModelsRepo — pure data-access layer for the `models` table.
 *
 * Per Phase 0 + decision #1 (platform-shared API keys), this is a global
 * table without user_id; all callers see the same rows. Will be renamed to
 * `platform_models` in a later phase but the schema stays the same.
 *
 * Business rules (env override application, role auto-fallback, "default"
 * resolution semantics) live in the calling service (SettingsStore).
 */

import { Database } from "bun:sqlite";

export interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_key: string | null;
  base_url: string | null;
  max_context_tokens: number;
  thinking: string;
  is_default: number;
  cost_input: number | null;
  cost_output: number | null;
  cost_cache_read: number | null;
  cost_cache_write: number | null;
  auth_type: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  role: string | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertModelParams {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  maxContextTokens: number;
  thinking: string;
  isDefault: number;
  role: string | null;
  costInput: number | null;
  costOutput: number | null;
  costCacheRead: number | null;
  costCacheWrite: number | null;
  authType: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class ModelsRepo {
  private readonly stmtList;
  private readonly stmtGetById;
  private readonly stmtGetDefault;
  private readonly stmtGetFirst;
  private readonly stmtGetByRole;
  private readonly stmtUpsert;
  private readonly stmtDelete;
  private readonly stmtClearAllDefault;
  private readonly stmtSetDefault;
  private readonly stmtClearRole;
  private readonly stmtSetRole;
  private readonly stmtChanges;

  constructor(private readonly db: Database) {
    this.stmtList = db.prepare(
      "SELECT * FROM models ORDER BY is_default DESC, name ASC",
    );
    this.stmtGetById = db.prepare("SELECT * FROM models WHERE id = ?");
    this.stmtGetDefault = db.prepare(
      "SELECT * FROM models WHERE is_default = 1 LIMIT 1",
    );
    // Deterministic fallback when no default is set: oldest first.
    this.stmtGetFirst = db.prepare(
      "SELECT * FROM models ORDER BY created_at ASC LIMIT 1",
    );
    this.stmtGetByRole = db.prepare(
      "SELECT * FROM models WHERE role = ? LIMIT 1",
    );
    this.stmtUpsert = db.prepare(
      `INSERT INTO models (id, name, provider, model, api_key, base_url, max_context_tokens, thinking, is_default, role, cost_input, cost_output, cost_cache_read, cost_cache_write, auth_type, refresh_token, token_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, provider = excluded.provider, model = excluded.model,
         api_key = excluded.api_key, base_url = excluded.base_url,
         max_context_tokens = excluded.max_context_tokens, thinking = excluded.thinking,
         is_default = excluded.is_default, role = excluded.role,
         cost_input = excluded.cost_input, cost_output = excluded.cost_output,
         cost_cache_read = excluded.cost_cache_read, cost_cache_write = excluded.cost_cache_write,
         auth_type = excluded.auth_type, refresh_token = excluded.refresh_token,
         token_expires_at = excluded.token_expires_at,
         updated_at = excluded.updated_at`,
    );
    this.stmtDelete = db.prepare("DELETE FROM models WHERE id = ?");
    this.stmtClearAllDefault = db.prepare("UPDATE models SET is_default = 0");
    this.stmtSetDefault = db.prepare(
      "UPDATE models SET is_default = 1 WHERE id = ?",
    );
    this.stmtClearRole = db.prepare(
      "UPDATE models SET role = NULL WHERE role = ?",
    );
    this.stmtSetRole = db.prepare("UPDATE models SET role = ? WHERE id = ?");
    this.stmtChanges = db.prepare("SELECT changes() as c");
  }

  list(): readonly ModelRow[] {
    return this.stmtList.all() as ModelRow[];
  }

  findById(id: string): ModelRow | undefined {
    return this.stmtGetById.get(id) as ModelRow | undefined;
  }

  /** First model marked is_default = 1, or undefined. Caller decides whether to fall back. */
  findDefault(): ModelRow | undefined {
    return this.stmtGetDefault.get() as ModelRow | undefined;
  }

  findFirst(): ModelRow | undefined {
    return this.stmtGetFirst.get() as ModelRow | undefined;
  }

  findByRole(role: string): ModelRow | undefined {
    return this.stmtGetByRole.get(role) as ModelRow | undefined;
  }

  upsert(p: UpsertModelParams): void {
    this.stmtUpsert.run(
      p.id,
      p.name,
      p.provider,
      p.model,
      p.apiKey,
      p.baseUrl,
      p.maxContextTokens,
      p.thinking,
      p.isDefault,
      p.role,
      p.costInput,
      p.costOutput,
      p.costCacheRead,
      p.costCacheWrite,
      p.authType,
      p.refreshToken,
      p.tokenExpiresAt,
      p.createdAt,
      p.updatedAt,
    );
  }

  delete(id: string): boolean {
    this.stmtDelete.run(id);
    return this.lastChanges() > 0;
  }

  /** Atomically: clear is_default on all rows, then set on the target id. */
  setDefault(id: string): void {
    this.db.transaction(() => {
      this.stmtClearAllDefault.run();
      this.stmtSetDefault.run(id);
    })();
  }

  /** Atomically: clear given role from all rows, then assign role on target id (or null to clear). */
  setRole(id: string, role: string | null): void {
    this.db.transaction(() => {
      if (role) this.stmtClearRole.run(role);
      this.stmtSetRole.run(role, id);
    })();
  }

  private lastChanges(): number {
    return (this.stmtChanges.get() as { c: number }).c;
  }
}
