/**
 * Feishu message deduplication: memory + persistent file-based.
 * Aligned with OpenClaw's extensions/feishu/src/dedup.ts
 *
 * Two-tier dedup:
 * 1. Memory: fast in-process check (1000 entries, 24h TTL)
 * 2. Persistent: survives restarts (10000 entries, 24h TTL, file-backed)
 * Plus processing claims to prevent concurrent handling of the same message.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLAIM_MAX_SIZE = 2_000;

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

class TtlCache {
  private readonly entries = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs: number, maxSize: number) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /**
   * Check if key exists and is not expired.
   * If not present, records it and returns false (= not duplicate).
   * If present and fresh, returns true (= duplicate).
   */
  check(key: string | null): boolean {
    if (!key) return false;
    const now = Date.now();
    this.pruneIfNeeded(now);

    const existing = this.entries.get(key);
    if (existing !== undefined && now - existing < this.ttlMs) {
      return true; // duplicate
    }
    this.entries.set(key, now);
    return false; // first seen
  }

  peek(key: string): boolean {
    const ts = this.entries.get(key);
    if (ts === undefined) return false;
    return Date.now() - ts < this.ttlMs;
  }

  delete(key: string | null): void {
    if (key) this.entries.delete(key);
  }

  private pruneIfNeeded(now: number): void {
    if (this.entries.size <= this.maxSize) return;
    for (const [k, ts] of this.entries) {
      if (now - ts >= this.ttlMs) this.entries.delete(k);
    }
    // If still over limit, remove oldest
    if (this.entries.size > this.maxSize) {
      const toDelete = this.entries.size - this.maxSize;
      let deleted = 0;
      for (const key of this.entries.keys()) {
        if (deleted >= toDelete) break;
        this.entries.delete(key);
        deleted++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Persistent file-backed dedup
// ---------------------------------------------------------------------------

type PersistentData = Record<string, number>;

function resolveFilePath(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(homedir(), ".klaus", "feishu", "dedup", `${safe}.json`);
}

function readPersistentDataSync(filePath: string): PersistentData {
  try {
    if (!existsSync(filePath)) return {};
    return JSON.parse(readFileSync(filePath, "utf-8")) as PersistentData;
  } catch {
    return {};
  }
}

async function readPersistentData(filePath: string): Promise<PersistentData> {
  try {
    if (!existsSync(filePath)) return {};
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as PersistentData;
  } catch {
    return {};
  }
}

async function writePersistentData(filePath: string, data: PersistentData): Promise<void> {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, JSON.stringify(data), "utf-8");
  } catch (err) {
    console.warn("[Feishu-Dedup] Failed to write dedup file:", err);
  }
}

function prunePersistentData(data: PersistentData, now: number, maxEntries: number): PersistentData {
  // Remove expired entries
  const pruned: PersistentData = {};
  const entries = Object.entries(data).filter(([, ts]) => now - ts < DEDUP_TTL_MS);
  // Keep only latest maxEntries
  entries.sort((a, b) => b[1] - a[1]);
  for (const [key, ts] of entries.slice(0, maxEntries)) {
    pruned[key] = ts;
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

const memoryDedup = new TtlCache(DEDUP_TTL_MS, MEMORY_MAX_SIZE);
const processingClaims = new TtlCache(CLAIM_TTL_MS, CLAIM_MAX_SIZE);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveKey(namespace: string, messageId: string | undefined | null): string | null {
  const trimmed = messageId?.trim();
  return trimmed ? `${namespace}:${trimmed}` : null;
}

/**
 * Try to begin processing a message. Returns true if processing can proceed
 * (message not currently being processed). Returns false if already claimed.
 */
export function tryBeginProcessing(
  messageId: string | undefined | null,
  namespace = "global",
): boolean {
  return !processingClaims.check(resolveKey(namespace, messageId));
}

/**
 * Release a processing claim.
 */
export function releaseProcessing(
  messageId: string | undefined | null,
  namespace = "global",
): void {
  processingClaims.delete(resolveKey(namespace, messageId));
}

/**
 * Record a message as processed (memory + persistent).
 * Returns true if successfully recorded (not previously processed).
 */
async function recordProcessed(
  messageId: string | undefined | null,
  namespace = "global",
): Promise<boolean> {
  const trimmed = messageId?.trim();
  if (!trimmed) return false;

  const memKey = resolveKey(namespace, messageId);
  if (!memKey) return false;

  // Check memory first
  if (memoryDedup.peek(memKey)) return false;
  memoryDedup.check(memKey);

  // Persistent
  const filePath = resolveFilePath(namespace);
  const now = Date.now();
  const data = await readPersistentData(filePath);

  if (trimmed in data && now - data[trimmed] < DEDUP_TTL_MS) {
    return false; // Already recorded on disk
  }

  data[trimmed] = now;
  const pruned = prunePersistentData(data, now, FILE_MAX_ENTRIES);
  await writePersistentData(filePath, pruned);
  return true;
}

/**
 * Finalize message processing: record in both tiers and release claim.
 */
export async function finalizeProcessing(
  messageId: string | undefined | null,
  namespace = "global",
): Promise<boolean> {
  const trimmed = messageId?.trim();
  if (!trimmed) return false;

  const result = await recordProcessed(trimmed, namespace);
  releaseProcessing(trimmed, namespace);
  return result;
}

/**
 * Warm up memory dedup cache from persistent storage.
 */
export function warmupFromDisk(namespace: string): number {
  const filePath = resolveFilePath(namespace);
  const data = readPersistentDataSync(filePath);
  const now = Date.now();
  let loaded = 0;

  for (const [key, ts] of Object.entries(data)) {
    if (now - ts < DEDUP_TTL_MS) {
      const memKey = `${namespace}:${key}`;
      memoryDedup.check(memKey);
      loaded++;
    }
  }
  return loaded;
}
