/**
 * Session persistence: saves Claude SDK session IDs to ~/.klaus/sessions.json
 * so conversations can be resumed after process restart.
 *
 * Design: write-through cache with atomic file writes (temp + rename).
 * Claude SDK maintains conversation history server-side; we only persist
 * the session ID (resume token).
 */

import {
  readFile,
  writeFile,
  rename,
  rm,
  mkdir,
  chmod,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedSession {
  readonly sessionId: string;
  readonly sessionKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly model?: string;
}

interface SessionStoreData {
  readonly version: 1;
  readonly sessions: Record<string, PersistedSession>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_ENTRIES = 100;

export { DEFAULT_IDLE_MS, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_ENTRIES };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidStoreData(data: unknown): data is SessionStoreData {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (
    !obj.sessions ||
    typeof obj.sessions !== "object" ||
    Array.isArray(obj.sessions)
  )
    return false;
  return true;
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  private readonly storePath: string;
  private cache: Record<string, PersistedSession> = {};
  private dirty = false;

  constructor(storePath?: string) {
    this.storePath = storePath ?? join(CONFIG_DIR, "sessions.json");
  }

  // -- Lifecycle ------------------------------------------------------------

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidStoreData(parsed)) {
        this.cache = { ...parsed.sessions };
      } else {
        console.log("[SessionStore] Invalid sessions file, starting fresh");
        this.cache = {};
      }
    } catch {
      // File missing or unreadable — start with empty store
      this.cache = {};
    }
    this.dirty = false;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;

    const data: SessionStoreData = {
      version: 1,
      sessions: { ...this.cache },
    };
    const json = JSON.stringify(data, null, 2);

    await mkdir(dirname(this.storePath), { recursive: true });

    // Atomic write: temp file → rename
    const tmp = `${this.storePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, json, "utf-8");
      await chmod(tmp, 0o600).catch(() => {}); // best-effort
      await rename(tmp, this.storePath);
      this.dirty = false;
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.save();
  }

  // -- CRUD -----------------------------------------------------------------

  get(sessionKey: string): PersistedSession | undefined {
    return this.cache[sessionKey];
  }

  set(sessionKey: string, entry: PersistedSession): void {
    this.cache[sessionKey] = entry;
    this.dirty = true;
  }

  delete(sessionKey: string): void {
    if (sessionKey in this.cache) {
      delete this.cache[sessionKey];
      this.dirty = true;
    }
  }

  // -- Queries --------------------------------------------------------------

  isFresh(sessionKey: string, idleMs: number = DEFAULT_IDLE_MS): boolean {
    const entry = this.cache[sessionKey];
    if (!entry) return false;
    return Date.now() - entry.updatedAt < idleMs;
  }

  // -- Maintenance ----------------------------------------------------------

  pruneStale(maxAgeMs: number = DEFAULT_MAX_AGE_MS): number {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return 0;
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    const next: Record<string, PersistedSession> = {};
    for (const [key, entry] of Object.entries(this.cache)) {
      if (entry.updatedAt < cutoff) {
        pruned++;
      } else {
        next[key] = entry;
      }
    }
    if (pruned > 0) {
      this.cache = next;
      this.dirty = true;
      console.log(`[SessionStore] Pruned ${pruned} stale session(s)`);
    }
    return pruned;
  }

  capEntries(maxEntries: number = DEFAULT_MAX_ENTRIES): number {
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) return 0;
    const keys = Object.keys(this.cache);
    if (keys.length <= maxEntries) return 0;

    // Keep the most recently updated entries
    const sorted = [...keys].sort(
      (a: string, b: string) =>
        (this.cache[b]?.updatedAt ?? 0) - (this.cache[a]?.updatedAt ?? 0),
    );
    const next: Record<string, PersistedSession> = {};
    for (const key of sorted.slice(0, maxEntries)) {
      next[key] = this.cache[key];
    }
    const removed = keys.length - maxEntries;
    this.cache = next;
    this.dirty = true;
    console.log(`[SessionStore] Capped entries, removed ${removed}`);
    return removed;
  }
}
