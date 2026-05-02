/**
 * PromptsRepoPg — PG implementation of the platform_prompts table repo.
 * SQLite calls it `prompts`; PG calls it `platform_prompts` per Phase 0 split.
 */

import { eq, asc, desc } from "drizzle-orm";
import type { Db } from "../connection.js";
import { platformPrompts } from "../schema.js";

export interface PromptRow {
  id: string;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertPromptParams {
  id: string;
  name: string;
  content: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

function toRow(r: typeof platformPrompts.$inferSelect): PromptRow {
  return {
    id: r.id,
    name: r.name,
    content: r.content,
    is_default: r.isDefault ? 1 : 0,
    created_at: r.createdAt.getTime(),
    updated_at: r.updatedAt.getTime(),
  };
}

export class PromptsRepoPg {
  constructor(private readonly db: Db) {}

  async list(): Promise<readonly PromptRow[]> {
    const rows = await this.db
      .select()
      .from(platformPrompts)
      .orderBy(desc(platformPrompts.isDefault), asc(platformPrompts.name));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<PromptRow | undefined> {
    const r = await this.db
      .select()
      .from(platformPrompts)
      .where(eq(platformPrompts.id, id))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findDefault(): Promise<PromptRow | undefined> {
    const r = await this.db
      .select()
      .from(platformPrompts)
      .where(eq(platformPrompts.isDefault, true))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async findFirst(): Promise<PromptRow | undefined> {
    const r = await this.db
      .select()
      .from(platformPrompts)
      .orderBy(asc(platformPrompts.createdAt))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async upsert(p: UpsertPromptParams): Promise<void> {
    await this.db
      .insert(platformPrompts)
      .values({
        id: p.id,
        name: p.name,
        content: p.content,
        isDefault: p.isDefault === 1,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      })
      .onConflictDoUpdate({
        target: platformPrompts.id,
        set: {
          name: p.name,
          content: p.content,
          isDefault: p.isDefault === 1,
          updatedAt: new Date(p.updatedAt),
        },
      });
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.db
      .delete(platformPrompts)
      .where(eq(platformPrompts.id, id))
      .returning({ id: platformPrompts.id });
    return r.length > 0;
  }

  async setDefault(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(platformPrompts).set({ isDefault: false });
      await tx
        .update(platformPrompts)
        .set({ isDefault: true })
        .where(eq(platformPrompts.id, id));
    });
  }
}
