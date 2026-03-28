/**
 * Temporal decay scoring — ported from OpenClaw.
 * Applies exponential decay to search results based on file age.
 * Evergreen files (MEMORY.md, memory/*.md without date) are not decayed.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type TemporalDecayConfig = {
  enabled: boolean;
  halfLifeDays: number;
};

const DEFAULT_TEMPORAL_DECAY_CONFIG: TemporalDecayConfig = {
  enabled: false,
  halfLifeDays: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATED_MEMORY_PATH_RE = /(?:^|\/)memory\/(\d{4})-(\d{2})-(\d{2})\.md$/;

function toDecayLambda(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

function calculateMultiplier(ageInDays: number, halfLifeDays: number): number {
  const lambda = toDecayLambda(halfLifeDays);
  const clamped = Math.max(0, ageInDays);
  if (lambda <= 0 || !Number.isFinite(clamped)) return 1;
  return Math.exp(-lambda * clamped);
}

function parseMemoryDate(filePath: string): Date | null {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const match = DATED_MEMORY_PATH_RE.exec(normalized);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const ts = Date.UTC(year, month - 1, day);
  const parsed = new Date(ts);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return parsed;
}

function isEvergreenMemoryPath(filePath: string): boolean {
  const n = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (n === "MEMORY.md" || n === "memory.md") return true;
  if (!n.startsWith("memory/")) return false;
  return !DATED_MEMORY_PATH_RE.test(n);
}

async function extractTimestamp(filePath: string, source: string, workspaceDir?: string): Promise<Date | null> {
  const fromPath = parseMemoryDate(filePath);
  if (fromPath) return fromPath;
  if (source === "memory" && isEvergreenMemoryPath(filePath)) return null;
  if (!workspaceDir) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceDir, filePath);
  try {
    const stat = await fs.stat(abs);
    return Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs) : null;
  } catch {
    return null;
  }
}

/**
 * Apply temporal decay to search results. Evergreen files are not decayed.
 */
export async function applyTemporalDecay<
  T extends { path: string; score: number; source: string },
>(params: {
  results: T[];
  config?: Partial<TemporalDecayConfig>;
  workspaceDir?: string;
  nowMs?: number;
}): Promise<T[]> {
  const cfg = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...params.config };
  if (!cfg.enabled) return [...params.results];

  const nowMs = params.nowMs ?? Date.now();
  const cache = new Map<string, Promise<Date | null>>();

  return Promise.all(
    params.results.map(async (entry) => {
      const key = `${entry.source}:${entry.path}`;
      let tsPromise = cache.get(key);
      if (!tsPromise) {
        tsPromise = extractTimestamp(entry.path, entry.source, params.workspaceDir);
        cache.set(key, tsPromise);
      }
      const ts = await tsPromise;
      if (!ts) return entry;
      const ageInDays = Math.max(0, nowMs - ts.getTime()) / DAY_MS;
      return { ...entry, score: entry.score * calculateMultiplier(ageInDays, cfg.halfLifeDays) };
    }),
  );
}
