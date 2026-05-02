/**
 * UserPromptsRepoPg — PG implementation. Per-user prompts (RLS-protected).
 * Caller must use withUserScope(userId, fn) to set app.current_user_id.
 */

import { and, eq, asc, desc } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { userPrompts } from "../schema.js";

export interface UserPromptRow {
  id: string;
  user_id: string;
  name: string;
  content: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertUserPromptParams {
  id: string;
  userId: string;
  name: string;
  content: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

function toRow(r: typeof userPrompts.$inferSelect): UserPromptRow {
  return {
    id: r.id,
    user_id: r.userId,
    name: r.name,
    content: r.content,
    is_default: r.isDefault ? 1 : 0,
    created_at: r.createdAt.getTime(),
    updated_at: r.updatedAt.getTime(),
  };
}

export class UserPromptsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async listByUser(userId: string): Promise<readonly UserPromptRow[]> {
    // RLS will scope to current user automatically; the explicit user_id is
    // belt-and-suspenders.
    const rows = await this.dbOrTx
      .select()
      .from(userPrompts)
      .where(eq(userPrompts.userId, userId))
      .orderBy(desc(userPrompts.isDefault), asc(userPrompts.name));
    return rows.map(toRow);
  }

  async findById(id: string, userId: string): Promise<UserPromptRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(userPrompts)
      .where(and(eq(userPrompts.id, id), eq(userPrompts.userId, userId)))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async upsert(p: UpsertUserPromptParams): Promise<void> {
    await this.dbOrTx
      .insert(userPrompts)
      .values({
        id: p.id,
        userId: p.userId,
        name: p.name,
        content: p.content,
        isDefault: p.isDefault === 1,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      })
      .onConflictDoUpdate({
        target: userPrompts.id,
        set: {
          name: p.name,
          content: p.content,
          isDefault: p.isDefault === 1,
          updatedAt: new Date(p.updatedAt),
        },
      });
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(userPrompts)
      .where(and(eq(userPrompts.id, id), eq(userPrompts.userId, userId)))
      .returning({ id: userPrompts.id });
    return r.length > 0;
  }

  async setDefault(id: string, userId: string): Promise<void> {
    await this.dbOrTx.transaction(async (tx) => {
      await tx
        .update(userPrompts)
        .set({ isDefault: false })
        .where(eq(userPrompts.userId, userId));
      await tx
        .update(userPrompts)
        .set({ isDefault: true })
        .where(and(eq(userPrompts.id, id), eq(userPrompts.userId, userId)));
    });
  }
}
