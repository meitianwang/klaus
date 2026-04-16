/**
 * Shared message dedup utility for channel plugins.
 *
 * Replaces the per-channel copy-pasted dedup logic with a single reusable
 * implementation: in-memory Map with TTL eviction and entry cap.
 */

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

export class MessageDedup {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Returns true if this key has been seen within the TTL window.
   * If not a duplicate, records it for future checks.
   */
  isDuplicate(key: string): boolean {
    const now = Date.now();
    const prev = this.seen.get(key);
    if (typeof prev === "number" && now - prev < this.ttlMs) {
      return true;
    }

    this.seen.set(key, now);

    if (this.seen.size > this.maxEntries) {
      for (const [k, ts] of this.seen) {
        if (now - ts > this.ttlMs) this.seen.delete(k);
      }
    }
    return false;
  }

  clear(): void {
    this.seen.clear();
  }
}
