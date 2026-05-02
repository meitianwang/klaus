/**
 * TokenUsageRepoPg — PG implementation of token_usage (RLS-protected).
 * Aggregates use SUM with COALESCE to default 0 when no rows match.
 */

import { and, eq, gte, sql, desc } from "drizzle-orm";
import type { Db, DbTx } from "../connection.js";
import { tokenUsage } from "../schema.js";

export interface TokenUsageRow {
  id: number;
  user_id: string;
  session_id: string | null;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
  occurred_at: number;
}

export interface InsertTokenUsageParams {
  userId: string;
  sessionId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  occurredAt: number;
}

function toRow(r: typeof tokenUsage.$inferSelect): TokenUsageRow {
  return {
    id: r.id,
    user_id: r.userId,
    session_id: r.sessionId,
    model_id: r.modelId,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    cache_read: r.cacheRead,
    cache_write: r.cacheWrite,
    cost_usd: Number(r.costUsd),
    occurred_at: r.occurredAt.getTime(),
  };
}

export class TokenUsageRepoPg {
  constructor(private readonly dbOrTx: Db | DbTx) {}

  async insert(p: InsertTokenUsageParams): Promise<void> {
    await this.dbOrTx.insert(tokenUsage).values({
      userId: p.userId,
      sessionId: p.sessionId,
      modelId: p.modelId,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      cacheRead: p.cacheRead,
      cacheWrite: p.cacheWrite,
      costUsd: String(p.costUsd),
      occurredAt: new Date(p.occurredAt),
    });
  }

  async sumByUserSince(
    userId: string,
    sinceTs: number,
  ): Promise<{
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
  }> {
    const r = await this.dbOrTx
      .select({
        inputTokens: sql<number>`COALESCE(SUM(${tokenUsage.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`COALESCE(SUM(${tokenUsage.outputTokens}), 0)::bigint`,
        cacheRead: sql<number>`COALESCE(SUM(${tokenUsage.cacheRead}), 0)::bigint`,
        cacheWrite: sql<number>`COALESCE(SUM(${tokenUsage.cacheWrite}), 0)::bigint`,
        costUsd: sql<number>`COALESCE(SUM(${tokenUsage.costUsd}), 0)::numeric`,
      })
      .from(tokenUsage)
      .where(
        and(
          eq(tokenUsage.userId, userId),
          gte(tokenUsage.occurredAt, new Date(sinceTs)),
        ),
      );
    const row = r[0]!;
    return {
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      cacheRead: Number(row.cacheRead),
      cacheWrite: Number(row.cacheWrite),
      costUsd: Number(row.costUsd),
    };
  }

  async listByUser(userId: string, limit: number = 100): Promise<readonly TokenUsageRow[]> {
    const rows = await this.dbOrTx
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.userId, userId))
      .orderBy(desc(tokenUsage.occurredAt))
      .limit(limit);
    return rows.map(toRow);
  }
}
