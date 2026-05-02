/**
 * SessionsRepoPg — PG implementation of the sessions index table.
 *
 * Per decision #5, transcript content lives in CC engine's local JSONL files
 * (referenced by `transcript_path`), NOT in this DB.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { sessions } from "../schema.js";

export interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  cwd: string | null;
  transcript_path: string | null;
  created_at: number;
  last_active_at: number | null;
}

export interface UpsertSessionParams {
  id: string;
  userId: string;
  title: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  createdAt: number;
  lastActiveAt: number | null;
}

function toRow(r: typeof sessions.$inferSelect): SessionRow {
  return {
    id: r.id,
    user_id: r.userId,
    title: r.title,
    cwd: r.cwd,
    transcript_path: r.transcriptPath,
    created_at: r.createdAt.getTime(),
    last_active_at: r.lastActiveAt?.getTime() ?? null,
  };
}

export class SessionsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async upsert(p: UpsertSessionParams): Promise<void> {
    await this.dbOrTx
      .insert(sessions)
      .values({
        id: p.id,
        userId: p.userId,
        title: p.title,
        cwd: p.cwd,
        transcriptPath: p.transcriptPath,
        createdAt: new Date(p.createdAt),
        lastActiveAt: p.lastActiveAt == null ? null : new Date(p.lastActiveAt),
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          title: p.title,
          cwd: p.cwd,
          transcriptPath: p.transcriptPath,
          lastActiveAt: p.lastActiveAt == null ? null : new Date(p.lastActiveAt),
        },
      });
  }

  async findById(id: string): Promise<SessionRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async listByUser(userId: string): Promise<readonly SessionRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(sql`${sessions.lastActiveAt} DESC NULLS LAST`);
    return rows.map(toRow);
  }

  async touch(id: string, ts: number): Promise<void> {
    await this.dbOrTx
      .update(sessions)
      .set({ lastActiveAt: new Date(ts) })
      .where(eq(sessions.id, id));
  }

  async rename(id: string, title: string): Promise<boolean> {
    const r = await this.dbOrTx
      .update(sessions)
      .set({ title })
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    return r.length > 0;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.dbOrTx
      .delete(sessions)
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    return r.length > 0;
  }
}
