/**
 * ArtifactsRepoPg — PG implementation of session_artifacts (RLS-protected).
 *
 * NOTE: SQLite repo has both `upsert(sessionKey, ...)` and `upsertWithUser(...)`
 * variants for backward compat with legacy NULL user_id rows. PG schema makes
 * user_id NOT NULL — legacy data should be backfilled by the migration script
 * before switching to this repo. The non-user `upsert()` overload throws here.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { sessionArtifacts } from "../schema.js";

export interface ArtifactRow {
  session_key: string;
  file_path: string;
  last_op: string;
  first_seen_at: number;
  last_modified_at: number;
  user_id?: string | null;
}

function toRow(r: typeof sessionArtifacts.$inferSelect): ArtifactRow {
  return {
    session_key: r.sessionId,
    file_path: r.filePath,
    last_op: r.lastOp,
    first_seen_at: r.firstSeenAt.getTime(),
    last_modified_at: r.lastModifiedAt.getTime(),
    user_id: r.userId,
  };
}

export class ArtifactsRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  /** PG schema enforces NOT NULL user_id; this overload is no longer accepted. */
  upsert(): never {
    throw new Error(
      "[ArtifactsRepoPg.upsert] PG requires user_id; call upsertWithUser instead",
    );
  }

  async upsertWithUser(
    sessionKey: string,
    userId: string,
    filePath: string,
    op: string,
    ts: number,
  ): Promise<void> {
    await this.dbOrTx
      .insert(sessionArtifacts)
      .values({
        sessionId: sessionKey,
        userId,
        filePath,
        lastOp: op,
        firstSeenAt: new Date(ts),
        lastModifiedAt: new Date(ts),
      })
      .onConflictDoUpdate({
        target: [sessionArtifacts.sessionId, sessionArtifacts.filePath],
        set: {
          userId,
          lastOp: op,
          lastModifiedAt: new Date(ts),
        },
      });
  }

  async findBySessionAndPath(
    sessionKey: string,
    filePath: string,
  ): Promise<ArtifactRow | undefined> {
    const r = await this.dbOrTx
      .select()
      .from(sessionArtifacts)
      .where(
        and(
          eq(sessionArtifacts.sessionId, sessionKey),
          eq(sessionArtifacts.filePath, filePath),
        ),
      )
      .limit(1);
    return r[0] ? toRow(r[0]) : undefined;
  }

  async listBySession(sessionKey: string): Promise<readonly ArtifactRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(sessionArtifacts)
      .where(eq(sessionArtifacts.sessionId, sessionKey))
      .orderBy(sql`${sessionArtifacts.lastModifiedAt} DESC`);
    return rows.map(toRow);
  }

  async deleteBySession(sessionKey: string): Promise<number> {
    const r = await this.dbOrTx
      .delete(sessionArtifacts)
      .where(eq(sessionArtifacts.sessionId, sessionKey))
      .returning({ id: sessionArtifacts.id });
    return r.length;
  }
}
