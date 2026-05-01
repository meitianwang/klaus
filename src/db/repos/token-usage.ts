/**
 * TokenUsageRepo — pure data-access layer for the `token_usage` table.
 *
 * Records every LLM call's token counts + cost for per-user quota enforcement
 * (decision #1: platform-shared API key requires usage limits to control cost).
 *
 * Business rules (cost calculation, quota check vs current month, quota reset
 * cadence) live in the calling service (Phase 1 will introduce a UsageService).
 */

import { Database } from "bun:sqlite";

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

export class TokenUsageRepo {
  private readonly stmtInsert;
  private readonly stmtSumByUserSince;
  private readonly stmtListByUser;

  constructor(db: Database) {
    this.stmtInsert = db.prepare(
      `INSERT INTO token_usage (user_id, session_id, model_id, input_tokens, output_tokens, cache_read, cache_write, cost_usd, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.stmtSumByUserSince = db.prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read), 0) AS cache_read,
         COALESCE(SUM(cache_write), 0) AS cache_write,
         COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM token_usage
       WHERE user_id = ? AND occurred_at >= ?`,
    );
    this.stmtListByUser = db.prepare(
      "SELECT * FROM token_usage WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?",
    );
  }

  insert(p: InsertTokenUsageParams): void {
    this.stmtInsert.run(
      p.userId,
      p.sessionId,
      p.modelId,
      p.inputTokens,
      p.outputTokens,
      p.cacheRead,
      p.cacheWrite,
      p.costUsd,
      p.occurredAt,
    );
  }

  /** Aggregate user usage from `sinceTs` (inclusive) to now. */
  sumByUserSince(
    userId: string,
    sinceTs: number,
  ): {
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
  } {
    const row = this.stmtSumByUserSince.get(userId, sinceTs) as {
      input_tokens: number;
      output_tokens: number;
      cache_read: number;
      cache_write: number;
      cost_usd: number;
    };
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      costUsd: row.cost_usd,
    };
  }

  listByUser(userId: string, limit: number = 100): readonly TokenUsageRow[] {
    return this.stmtListByUser.all(userId, limit) as TokenUsageRow[];
  }
}
