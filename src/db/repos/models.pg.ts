/**
 * ModelsRepoPg — PG implementation of the platform_models table repo.
 *
 * Schema lift: SQLite calls the table `models`; PG calls it `platform_models`
 * (semantically platform-shared per decision #1, no user_id). Repo name kept
 * as ModelsRepoPg so the SettingsStore caller doesn't need a rename.
 */

import { eq, asc, desc, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { platformModels } from "../schema.js";

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

function toRow(r: typeof platformModels.$inferSelect): ModelRow {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    // api_key stays NULL on PG side (decision #1: from env / KMS, not stored)
    api_key: null,
    base_url: r.baseUrl,
    max_context_tokens: r.maxContextTokens,
    thinking: r.thinking,
    is_default: r.isDefault ? 1 : 0,
    cost_input: r.costInput == null ? null : Number(r.costInput),
    cost_output: r.costOutput == null ? null : Number(r.costOutput),
    cost_cache_read: r.costCacheRead == null ? null : Number(r.costCacheRead),
    cost_cache_write: r.costCacheWrite == null ? null : Number(r.costCacheWrite),
    auth_type: r.authType,
    refresh_token: r.refreshToken,
    token_expires_at: r.tokenExpiresAt,
    role: r.role,
    created_at: r.createdAt.getTime(),
    updated_at: r.updatedAt.getTime(),
  };
}

export class ModelsRepoPg {
  // Caller passes the global Db (no user scope needed — platform-global table).
  constructor(private readonly db: Db) {}

  async list(): Promise<readonly ModelRow[]> {
    const rows = await this.db
      .select()
      .from(platformModels)
      .orderBy(desc(platformModels.isDefault), asc(platformModels.name));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<ModelRow | undefined> {
    const r = await this.db
      .select()
      .from(platformModels)
      .where(eq(platformModels.id, id))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findDefault(): Promise<ModelRow | undefined> {
    const r = await this.db
      .select()
      .from(platformModels)
      .where(eq(platformModels.isDefault, true))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findFirst(): Promise<ModelRow | undefined> {
    const r = await this.db
      .select()
      .from(platformModels)
      .orderBy(asc(platformModels.createdAt))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findByRole(role: string): Promise<ModelRow | undefined> {
    const r = await this.db
      .select()
      .from(platformModels)
      .where(eq(platformModels.role, role))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async upsert(p: UpsertModelParams): Promise<void> {
    await this.db
      .insert(platformModels)
      .values({
        id: p.id,
        name: p.name,
        provider: p.provider,
        model: p.model,
        baseUrl: p.baseUrl,
        maxContextTokens: p.maxContextTokens,
        thinking: p.thinking,
        isDefault: p.isDefault === 1,
        role: p.role,
        costInput: p.costInput == null ? null : String(p.costInput),
        costOutput: p.costOutput == null ? null : String(p.costOutput),
        costCacheRead:
          p.costCacheRead == null ? null : String(p.costCacheRead),
        costCacheWrite:
          p.costCacheWrite == null ? null : String(p.costCacheWrite),
        authType: p.authType,
        refreshToken: p.refreshToken,
        tokenExpiresAt: p.tokenExpiresAt,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      })
      .onConflictDoUpdate({
        target: platformModels.id,
        set: {
          name: p.name,
          provider: p.provider,
          model: p.model,
          baseUrl: p.baseUrl,
          maxContextTokens: p.maxContextTokens,
          thinking: p.thinking,
          isDefault: p.isDefault === 1,
          role: p.role,
          costInput: p.costInput == null ? null : String(p.costInput),
          costOutput: p.costOutput == null ? null : String(p.costOutput),
          costCacheRead:
            p.costCacheRead == null ? null : String(p.costCacheRead),
          costCacheWrite:
            p.costCacheWrite == null ? null : String(p.costCacheWrite),
          authType: p.authType,
          refreshToken: p.refreshToken,
          tokenExpiresAt: p.tokenExpiresAt,
          updatedAt: new Date(p.updatedAt),
        },
      });
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.db
      .delete(platformModels)
      .where(eq(platformModels.id, id))
      .returning({ id: platformModels.id });
    return r.length > 0;
  }

  async setDefault(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(platformModels).set({ isDefault: false });
      await tx
        .update(platformModels)
        .set({ isDefault: true })
        .where(eq(platformModels.id, id));
    });
  }

  async setRole(id: string, role: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (role) {
        await tx
          .update(platformModels)
          .set({ role: null })
          .where(eq(platformModels.role, role));
      }
      await tx
        .update(platformModels)
        .set({ role })
        .where(eq(platformModels.id, id));
    });
  }
}
