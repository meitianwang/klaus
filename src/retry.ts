/**
 * Retry utility with exponential backoff + jitter.
 * Inspired by OpenClaw's retry infrastructure.
 */

export interface RetryConfig {
  /** Max retry attempts (including first try). Default: 3 */
  attempts: number;
  /** Initial delay in ms. Default: 500 */
  minDelayMs: number;
  /** Max delay cap in ms. Default: 30_000 */
  maxDelayMs: number;
  /** Jitter ratio 0–1 (reduces thundering herd). Default: 0.1 */
  jitter: number;
  /** Optional predicate — return false to abort retry immediately. */
  shouldRetry?: (err: unknown) => boolean;
}

export const DEFAULT_RETRY: RetryConfig = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

/**
 * Run `fn` with exponential backoff retry.
 *
 * @param fn        Async operation to retry
 * @param config    Partial retry config (merged with defaults)
 * @param label     Log label for diagnostics
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  label?: string,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY, ...config };
  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (cfg.shouldRetry && !cfg.shouldRetry(err)) break;
      if (attempt >= cfg.attempts) break;

      const baseDelay = Math.min(
        cfg.minDelayMs * 2 ** (attempt - 1),
        cfg.maxDelayMs,
      );
      const jitterOffset = baseDelay * cfg.jitter * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + jitterOffset));

      const tag = label ?? "operation";
      console.log(
        `[Retry] ${tag} failed (attempt ${attempt}/${cfg.attempts}), retrying in ${delay}ms…`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Reconnect loop — for long-lived connections (WebSocket / SSE)
// ---------------------------------------------------------------------------

export interface ReconnectConfig {
  /** Initial delay before first reconnect. Default: 2_000 */
  initialMs: number;
  /** Max delay cap. Default: 60_000 */
  maxMs: number;
  /** Growth factor. Default: 2 */
  factor: number;
  /** Jitter ratio 0–1. Default: 0.2 */
  jitter: number;
}

export const DEFAULT_RECONNECT: ReconnectConfig = {
  initialMs: 2_000,
  maxMs: 60_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * Compute backoff delay for a reconnect attempt.
 */
export function computeBackoff(
  cfg: ReconnectConfig,
  attempt: number,
): number {
  const base = cfg.initialMs * cfg.factor ** (attempt - 1);
  const capped = Math.min(base, cfg.maxMs);
  const jitterOffset = capped * cfg.jitter * Math.random();
  return Math.round(capped + jitterOffset);
}
