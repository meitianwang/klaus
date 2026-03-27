/**
 * MemoryManager — core memory index manager aligned with OpenClaw's MemoryIndexManager.
 * Includes: multi-provider embeddings, hybrid search, FTS-only fallback,
 * chokidar file watching, MMR re-ranking, temporal decay, multimodal indexing.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import chokidar, { type FSWatcher } from "chokidar";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runOpenAiBatch, runGeminiBatch, runVoyageBatch } from "./batch.js";
import { createEmbeddingProvider, DEFAULT_BASE_URLS, type EmbeddingProvider, type EmbeddingProviderResult } from "./embeddings.js";
import {
  buildFileEntry,
  buildFtsQuery,
  bm25RankToScore,
  chunkMarkdown,
  cosineSimilarity,
  ensureDir,
  hashText,
  isMemoryPath,
  listMemoryFiles,
  parseEmbedding,
  remapChunkLines,
  runWithConcurrency,
  truncateUtf16Safe,
  type MemoryChunk,
  type MemoryFileEntry,
} from "./internal.js";
import { applyMMRToResults } from "./mmr.js";
import { classify as classifyMultimodal, getExtensions as multimodalExtensions, buildLabel as multimodalLabel, supportsMultimodal } from "./multimodal.js";
import { ensureMemorySchema } from "./schema.js";
import {
  buildSessionEntry,
  listSessionFiles,
  type SessionFileEntry,
} from "./session-files.js";
import { applyTemporalDecay } from "./temporal-decay.js";
import { onSessionTranscriptUpdate } from "./transcript-events.js";
import type {
  MemoryConfig,
  MemorySearchResult,
  MemorySource,
  MemoryStatus,
  MemorySyncProgress,
} from "./types.js";

const META_KEY = "memory_index_meta_v1";
const SNIPPET_MAX_CHARS = 700;
const EMBEDDING_BATCH_MAX_TOKENS = 8000;
const EMBEDDING_INDEX_CONCURRENCY = 4;
const EMBEDDING_CACHE_MAX = 10_000;
const WATCH_SYNC_DEBOUNCE_MS = 2000;

// ---------------------------------------------------------------------------
// Keyword extraction for FTS-only mode — ported from OpenClaw query-expansion.ts
// ---------------------------------------------------------------------------

const STOP_WORDS_EN = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "am", "i", "me",
  "my", "we", "our", "you", "your", "he", "she", "it", "they", "them",
  "his", "her", "its", "their", "this", "that", "these", "those",
  "what", "which", "who", "whom", "when", "where", "why", "how",
  "not", "no", "nor", "and", "or", "but", "if", "then", "so",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
  "into", "about", "between", "through", "during", "before", "after",
  "above", "below", "up", "down", "out", "off", "over", "under",
  "again", "further", "too", "very", "just", "also", "now", "here",
  "there", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "than",
]);

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

function extractSearchKeywords(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (CJK_RE.test(trimmed)) {
    const cjkChars: string[] = [];
    for (const ch of trimmed) {
      if (CJK_RE.test(ch)) cjkChars.push(ch);
    }
    const keywords: string[] = [...cjkChars];
    for (let i = 0; i < cjkChars.length - 1; i++) {
      keywords.push(cjkChars[i]! + cjkChars[i + 1]!);
    }
    const nonCjk = trimmed.match(/[a-zA-Z0-9_]+/g) ?? [];
    for (const w of nonCjk) {
      if (w.length >= 3 && !STOP_WORDS_EN.has(w.toLowerCase())) keywords.push(w.toLowerCase());
    }
    return [...new Set(keywords)].slice(0, 20);
  }
  const words = trimmed.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !STOP_WORDS_EN.has(w) && !/^\d+$/.test(w)))].slice(0, 20);
}

import { redactSensitiveText } from "./redact.js";

// ---------------------------------------------------------------------------
// MemoryManager
// ---------------------------------------------------------------------------

type IndexMeta = {
  model: string;
  provider: string;
  chunkTokens: number;
  chunkOverlap: number;
  sources: MemorySource[];
};

export class MemoryManager {
  private readonly db: DatabaseType;
  private readonly config: MemoryConfig;
  readonly memoryDir: string;
  private readonly transcriptsDir: string | undefined;
  private provider: EmbeddingProvider | null = null;
  private providerInitialized = false;
  private fallbackFrom?: string;
  private fallbackReason?: string;
  private providerUnavailableReason?: string;
  private ftsAvailable = false;
  private dirty = false;
  private syncing: Promise<void> | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;
  private watchSyncTimer: NodeJS.Timeout | null = null;
  private sessionUnsubscribe: (() => void) | null = null;
  private sessionDirtyTimer: NodeJS.Timeout | null = null;
  private sessionDirtyFiles = new Set<string>();
  private closed = false;

  constructor(params: {
    dbPath: string;
    config: MemoryConfig;
    memoryDir: string;
    transcriptsDir?: string;
  }) {
    this.config = params.config;
    this.memoryDir = params.memoryDir;
    this.transcriptsDir = params.transcriptsDir;

    ensureDir(path.dirname(params.dbPath));
    ensureDir(params.memoryDir);

    this.db = new Database(params.dbPath);
    this.db.pragma("journal_mode = WAL");

    const schemaResult = ensureMemorySchema(this.db);
    this.ftsAvailable = schemaResult.ftsAvailable;
    if (schemaResult.ftsError) {
      console.warn(`[Memory] FTS5 unavailable: ${schemaResult.ftsError}`);
    }

    this.checkMetaAndReset();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  startPeriodicSync(): void {
    if (this.intervalTimer || this.config.sync.intervalMinutes <= 0) return;
    const intervalMs = this.config.sync.intervalMinutes * 60_000;
    this.intervalTimer = setInterval(() => {
      this.sync().catch((err) => console.warn(`[Memory] periodic sync failed: ${String(err)}`));
    }, intervalMs);
    this.intervalTimer.unref();
  }

  /**
   * Start chokidar file watcher for memory files — aligned with OpenClaw.
   */
  startWatcher(): void {
    if (this.watcher || !this.config.sync.watch || !this.config.sources.includes("memory")) return;

    const watchPaths = [
      path.join(this.memoryDir, "MEMORY.md"),
      path.join(this.memoryDir, "memory.md"),
      path.join(this.memoryDir, "memory", "**", "*.md"),
    ];

    // Add multimodal file patterns if enabled
    if (this.config.multimodal.enabled) {
      for (const modality of this.config.multimodal.modalities) {
        for (const ext of multimodalExtensions(modality)) {
          watchPaths.push(path.join(this.memoryDir, "memory", "**", `*${ext}`));
        }
      }
    }

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: (wp: string) => {
        const parts = path.normalize(wp).split(path.sep);
        return parts.some((s) => [".git", "node_modules", ".venv", "__pycache__"].includes(s.toLowerCase()));
      },
      awaitWriteFinish: {
        stabilityThreshold: this.config.sync.watchDebounceMs,
        pollInterval: 100,
      },
    });

    const markDirty = () => {
      this.dirty = true;
      this.scheduleWatchSync();
    };
    this.watcher.on("add", markDirty);
    this.watcher.on("change", markDirty);
    this.watcher.on("unlink", markDirty);
  }

  private scheduleWatchSync(): void {
    if (this.watchSyncTimer) return;
    this.watchSyncTimer = setTimeout(() => {
      this.watchSyncTimer = null;
      this.sync().catch((err) => console.warn(`[Memory] watch sync failed: ${String(err)}`));
    }, WATCH_SYNC_DEBOUNCE_MS);
    this.watchSyncTimer.unref();
  }

  /**
   * Start session transcript event listener — aligned with OpenClaw.
   * Triggers incremental sync when new messages are appended to session files.
   */
  startSessionListener(): void {
    if (this.sessionUnsubscribe || !this.config.sources.includes("sessions")) return;
    this.sessionUnsubscribe = onSessionTranscriptUpdate((update) => {
      if (this.closed) return;
      this.sessionDirtyFiles.add(update.sessionFile);
      this.scheduleSessionSync();
    });
  }

  private scheduleSessionSync(): void {
    if (this.sessionDirtyTimer) return;
    this.sessionDirtyTimer = setTimeout(() => {
      this.sessionDirtyTimer = null;
      if (this.sessionDirtyFiles.size > 0) {
        this.sessionDirtyFiles.clear();
        this.dirty = true;
        this.sync().catch((err) => console.warn(`[Memory] session sync failed: ${String(err)}`));
      }
    }, 5000);
    this.sessionDirtyTimer.unref();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
    if (this.watchSyncTimer) { clearTimeout(this.watchSyncTimer); this.watchSyncTimer = null; }
    if (this.sessionDirtyTimer) { clearTimeout(this.sessionDirtyTimer); this.sessionDirtyTimer = null; }
    if (this.sessionUnsubscribe) { this.sessionUnsubscribe(); this.sessionUnsubscribe = null; }
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
    if (this.syncing) { try { await this.syncing; } catch {} }
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Embedding provider — auto-detect + fallback
  // -------------------------------------------------------------------------

  async initProvider(): Promise<void> {
    if (this.providerInitialized) return;
    this.providerInitialized = true;
    try {
      const result = await createEmbeddingProvider(this.config);
      this.applyProviderResult(result);
    } catch (err) {
      this.providerUnavailableReason = err instanceof Error ? err.message : String(err);
      console.warn(`[Memory] Embedding provider init failed: ${this.providerUnavailableReason}`);
    }
  }

  private applyProviderResult(result: EmbeddingProviderResult): void {
    this.provider = result.provider;
    this.fallbackFrom = result.fallbackFrom;
    this.fallbackReason = result.fallbackReason;
    this.providerUnavailableReason = result.providerUnavailableReason;
    if (result.provider) {
      console.log(`[Memory] Embedding provider: ${result.provider.id} (model=${result.provider.model})`);
      if (result.fallbackFrom) {
        console.log(`[Memory]   fallback from ${result.fallbackFrom}: ${result.fallbackReason}`);
      }
    } else {
      console.log(`[Memory] No embedding provider available, using FTS-only mode`);
      if (result.providerUnavailableReason) {
        console.log(`[Memory]   ${result.providerUnavailableReason}`);
      }
    }
  }

  get searchMode(): "hybrid" | "vector" | "fts-only" {
    if (!this.provider) return "fts-only";
    if (this.config.query.hybrid.enabled && this.ftsAvailable) return "hybrid";
    return "vector";
  }

  get citationsMode(): import("./types.js").MemoryCitationsMode {
    return this.config.citations;
  }

  // -------------------------------------------------------------------------
  // Meta tracking
  // -------------------------------------------------------------------------

  private checkMetaAndReset(): void {
    const current: IndexMeta = {
      model: this.config.model,
      provider: this.config.provider,
      chunkTokens: this.config.chunking.tokens,
      chunkOverlap: this.config.chunking.overlap,
      sources: [...this.config.sources].sort(),
    };
    const serialized = JSON.stringify(current);
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(META_KEY) as { value: string } | undefined;
    if (row?.value === serialized) return;
    console.log("[Memory] Configuration changed, re-indexing...");
    this.db.exec("DELETE FROM chunks");
    this.db.exec("DELETE FROM files");
    if (this.ftsAvailable) { try { this.db.exec("DELETE FROM chunks_fts"); } catch {} }
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(META_KEY, serialized);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  async sync(params?: { force?: boolean; progress?: (update: MemorySyncProgress) => void }): Promise<void> {
    if (this.closed) return;
    if (this.syncing) return this.syncing;
    this.syncing = this._doSync(params).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async _doSync(params?: { force?: boolean; progress?: (update: MemorySyncProgress) => void }): Promise<void> {
    const force = params?.force ?? false;
    const report = params?.progress ?? (() => {});

    // Collect current files (memory + multimodal + sessions)
    let memoryFiles: string[] = [];
    if (this.config.sources.includes("memory")) {
      memoryFiles = await listMemoryFiles(this.memoryDir);
      // Add multimodal files
      if (this.config.multimodal.enabled) {
        const mmFiles = await this.listMultimodalFiles();
        memoryFiles.push(...mmFiles);
      }
    }
    const sessionFiles = this.config.sources.includes("sessions") && this.transcriptsDir
      ? await listSessionFiles(this.transcriptsDir)
      : [];

    // Build entries (parallel I/O)
    const [memoryEntries, sessionEntries] = await Promise.all([
      Promise.all(memoryFiles.map((p) => buildFileEntry(p, this.memoryDir))).then((r) => r.filter((e): e is MemoryFileEntry => e !== null)),
      Promise.all(sessionFiles.map((p) => buildSessionEntry(p))).then((r) => r.filter((e): e is SessionFileEntry => e !== null)),
    ]);

    // Compare with DB
    const dbFiles = this.db.prepare("SELECT path, hash, source FROM files").all() as Array<{ path: string; hash: string; source: string }>;
    const dbFileMap = new Map(dbFiles.map((f) => [f.path, f]));

    type IndexTask = { source: MemorySource; entry: MemoryFileEntry | SessionFileEntry; content?: string };
    const toIndex: IndexTask[] = [];
    const currentPaths = new Set<string>();

    for (const entry of memoryEntries) {
      currentPaths.add(entry.path);
      const existing = dbFileMap.get(entry.path);
      if (!force && existing && existing.hash === entry.hash) continue;
      toIndex.push({ source: "memory", entry });
    }
    for (const entry of sessionEntries) {
      currentPaths.add(entry.path);
      const existing = dbFileMap.get(entry.path);
      if (!force && existing && existing.hash === entry.hash) continue;
      // Redact sensitive text in session content
      toIndex.push({ source: "sessions", entry, content: redactSensitiveText(entry.content) });
    }

    // Remove deleted files
    for (const dbFile of dbFiles) {
      if (!currentPaths.has(dbFile.path)) {
        this.db.prepare("DELETE FROM chunks WHERE path = ?").run(dbFile.path);
        this.db.prepare("DELETE FROM files WHERE path = ?").run(dbFile.path);
        if (this.ftsAvailable) { try { this.db.prepare("DELETE FROM chunks_fts WHERE path = ?").run(dbFile.path); } catch {} }
      }
    }

    if (toIndex.length === 0) { this.dirty = false; return; }
    report({ completed: 0, total: toIndex.length, label: "Indexing files" });

    let completed = 0;
    const tasks = toIndex.map((task) => async () => {
      await this.indexFile(task.entry, { source: task.source, content: task.content });
      completed++;
      report({ completed, total: toIndex.length });
    });

    await runWithConcurrency(tasks, EMBEDDING_INDEX_CONCURRENCY);
    this.pruneEmbeddingCacheIfNeeded();
    this.dirty = false;
    console.log(`[Memory] Sync complete: indexed ${toIndex.length} file(s)`);
  }

  private async listMultimodalFiles(): Promise<string[]> {
    const memDir = path.join(this.memoryDir, "memory");
    const result: string[] = [];
    try {
      const walk = async (dir: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { await walk(full); continue; }
          if (entry.isFile() && classifyMultimodal(full, this.config.multimodal)) {
            result.push(full);
          }
        }
      };
      await walk(memDir);
    } catch {}
    return result;
  }

  // -------------------------------------------------------------------------
  // Index a single file
  // -------------------------------------------------------------------------

  private async indexFile(
    entry: MemoryFileEntry | SessionFileEntry,
    options: { source: MemorySource; content?: string },
  ): Promise<void> {
    const provider = this.provider;
    if (!provider && !this.ftsAvailable) return;

    // Read content — multimodal files get a descriptive label instead of raw content
    let content: string;
    const modality = classifyMultimodal(entry.absPath, this.config.multimodal);
    if (modality) {
      // Multimodal file: use label text for FTS indexing
      content = multimodalLabel(modality, entry.path);
    } else if (options.content) {
      content = options.content;
    } else {
      try { content = await fs.readFile(entry.absPath, "utf-8"); } catch { return; }
    }
    if (!content.trim()) return;

    const chunks = chunkMarkdown(content, this.config.chunking);
    if (chunks.length === 0) return;
    if ("lineMap" in entry) remapChunkLines(chunks, entry.lineMap);

    // Compute embeddings (only when provider is available)
    const cached = new Map<string, number[]>();
    if (provider) {
      const hashes = chunks.map((c) => c.hash);
      const fromCache = this.loadEmbeddingCache(hashes);
      for (const [k, v] of fromCache) cached.set(k, v);
      const uncachedChunks = chunks.filter((c) => !cached.has(c.hash));

      if (uncachedChunks.length > 0) {
        // Use Batch API when enabled and provider supports it
        const batchCfg = this.config.batch;
        const providerCfg = this.config.providers[provider.id as keyof typeof this.config.providers];
        const apiKey = (providerCfg && "apiKey" in providerCfg) ? providerCfg.apiKey : undefined;
        const baseUrl = (providerCfg && "baseUrl" in providerCfg) ? providerCfg.baseUrl : undefined;

        if (batchCfg.enabled && apiKey && ["openai", "gemini", "voyage"].includes(provider.id)) {
          const batchRequests = uncachedChunks.map((c) => ({ customId: c.hash, text: c.text }));
          let batchResults: Map<string, number[]> | undefined;
          try {
            if (provider.id === "openai") {
              batchResults = await runOpenAiBatch({ requests: batchRequests, apiKey, baseUrl: baseUrl ?? DEFAULT_BASE_URLS.openai ?? "", model: provider.model, config: batchCfg });
            } else if (provider.id === "gemini") {
              batchResults = await runGeminiBatch({ requests: batchRequests, apiKey, baseUrl: baseUrl ?? DEFAULT_BASE_URLS.gemini ?? "", model: provider.model, config: batchCfg, outputDimensionality: this.config.outputDimensionality });
            } else if (provider.id === "voyage") {
              batchResults = await runVoyageBatch({ requests: batchRequests, apiKey, baseUrl: baseUrl ?? DEFAULT_BASE_URLS.voyage ?? "", model: provider.model, config: batchCfg });
            }
          } catch (err) {
            console.warn(`[Memory] Batch API failed, falling back to inline embedding: ${err instanceof Error ? err.message : String(err)}`);
          }
          if (batchResults) {
            const toCache: Array<{ hash: string; embedding: number[] }> = [];
            for (const [hash, vec] of batchResults) {
              cached.set(hash, vec);
              toCache.push({ hash, embedding: vec });
            }
            this.upsertEmbeddingCache(toCache);
          }
        }

        // Inline embedding for anything not yet cached (fallback or non-batch providers)
        const stillUncached = uncachedChunks.filter((c) => !cached.has(c.hash));
        if (stillUncached.length > 0) {
          const batches = this.buildEmbeddingBatches(stillUncached);
          for (const batch of batches) {
            const texts = batch.map((c) => c.text);
            const embeddings = await provider.embedBatch(texts);
            const toCache: Array<{ hash: string; embedding: number[] }> = [];
            for (let i = 0; i < batch.length; i++) {
              const emb = embeddings[i];
              if (emb) {
                cached.set(batch[i]!.hash, emb);
                toCache.push({ hash: batch[i]!.hash, embedding: emb });
              }
            }
            this.upsertEmbeddingCache(toCache);
          }
        }
      }
    }

    // Delete old chunks
    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(entry.path);
    if (this.ftsAvailable) { try { this.db.prepare("DELETE FROM chunks_fts WHERE path = ?").run(entry.path); } catch {} }

    // Insert new chunks
    const now = Date.now();
    const modelName = provider?.model ?? "fts-only";
    const insertChunk = this.db.prepare(
      `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = this.ftsAvailable
      ? this.db.prepare(`INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      : null;

    this.db.transaction(() => {
      for (const chunk of chunks) {
        const embedding = cached.get(chunk.hash);
        const embeddingJson = embedding ? JSON.stringify(embedding) : "[]";
        if (provider && !embedding) continue;
        const id = randomUUID();
        insertChunk.run(id, entry.path, options.source, chunk.startLine, chunk.endLine, chunk.hash, modelName, chunk.text, embeddingJson, now);
        insertFts?.run(chunk.text, id, entry.path, options.source, modelName, chunk.startLine, chunk.endLine);
      }
    })();

    this.db.prepare(
      `INSERT INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET source=excluded.source, hash=excluded.hash, mtime=excluded.mtime, size=excluded.size`,
    ).run(entry.path, options.source, entry.hash, Math.floor(entry.mtimeMs), entry.size);
  }

  // -------------------------------------------------------------------------
  // Embedding batching / cache
  // -------------------------------------------------------------------------

  private buildEmbeddingBatches(chunks: MemoryChunk[]): MemoryChunk[][] {
    const batches: MemoryChunk[][] = [];
    let current: MemoryChunk[] = [];
    let currentTokens = 0;
    for (const chunk of chunks) {
      const estimate = Math.ceil(chunk.text.length / 4);
      if (current.length > 0 && currentTokens + estimate > EMBEDDING_BATCH_MAX_TOKENS) {
        batches.push(current); current = []; currentTokens = 0;
      }
      if (current.length === 0 && estimate > EMBEDDING_BATCH_MAX_TOKENS) { batches.push([chunk]); continue; }
      current.push(chunk);
      currentTokens += estimate;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  private loadEmbeddingCache(hashes: string[]): Map<string, number[]> {
    if (hashes.length === 0) return new Map();
    const provider = this.provider;
    if (!provider) return new Map();
    const out = new Map<string, number[]>();
    for (let start = 0; start < hashes.length; start += 400) {
      const batch = hashes.slice(start, start + 400);
      const ph = batch.map(() => "?").join(", ");
      const rows = this.db.prepare(`SELECT hash, embedding FROM embedding_cache WHERE provider = ? AND model = ? AND hash IN (${ph})`).all(provider.id, provider.model, ...batch) as Array<{ hash: string; embedding: string }>;
      for (const row of rows) out.set(row.hash, parseEmbedding(row.embedding));
    }
    return out;
  }

  private upsertEmbeddingCache(entries: Array<{ hash: string; embedding: number[] }>): void {
    if (entries.length === 0 || !this.provider) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO embedding_cache (provider, model, hash, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, model, hash) DO UPDATE SET embedding=excluded.embedding, dims=excluded.dims, updated_at=excluded.updated_at`,
    );
    this.db.transaction(() => {
      for (const e of entries) stmt.run(this.provider!.id, this.provider!.model, e.hash, JSON.stringify(e.embedding), e.embedding.length, now);
    })();
  }

  private pruneEmbeddingCacheIfNeeded(): void {
    const count = (this.db.prepare("SELECT COUNT(*) as c FROM embedding_cache").get() as { c: number })?.c ?? 0;
    if (count <= EMBEDDING_CACHE_MAX) return;
    this.db.prepare(`DELETE FROM embedding_cache WHERE rowid IN (SELECT rowid FROM embedding_cache ORDER BY updated_at ASC LIMIT ?)`).run(count - EMBEDDING_CACHE_MAX);
  }

  // -------------------------------------------------------------------------
  // Search — vector + FTS hybrid + MMR + temporal decay
  // -------------------------------------------------------------------------

  async search(query: string, opts?: { maxResults?: number; minScore?: number }): Promise<MemorySearchResult[]> {
    if (this.closed) return [];
    if (this.dirty) await this.sync();

    const maxResults = opts?.maxResults ?? this.config.query.maxResults;
    const minScore = opts?.minScore ?? this.config.query.minScore;
    const provider = this.provider;
    const sourceFilter = this.buildSourceFilter();

    let results: MemorySearchResult[];

    // FTS-only mode
    if (!provider) {
      if (!this.ftsAvailable) return [];
      const keywords = extractSearchKeywords(query);
      if (keywords.length === 0) return [];
      const allResults = new Map<string, MemorySearchResult>();
      for (const keyword of keywords) {
        for (const r of this.searchFts(keyword, undefined, maxResults * 3, sourceFilter)) {
          const existing = allResults.get(r.id);
          if (!existing || r.textScore > existing.score) {
            allResults.set(r.id, {
              path: r.path, startLine: r.startLine, endLine: r.endLine,
              score: r.textScore, snippet: truncateUtf16Safe(r.text, SNIPPET_MAX_CHARS), source: r.source as MemorySource,
            });
          }
        }
      }
      results = [...allResults.values()].sort((a, b) => b.score - a.score);
    }
    // Hybrid mode
    else if (this.config.query.hybrid.enabled && this.ftsAvailable) {
      const vectorResults = this.searchVector(await provider.embedQuery(query), provider.model, maxResults * 3, sourceFilter);
      const ftsResults = this.searchFts(query, provider.model, maxResults * 3, sourceFilter);
      results = this.mergeHybridResults(vectorResults, ftsResults);
    }
    // Vector-only mode
    else {
      const queryVec = await provider.embedQuery(query);
      results = this.searchVector(queryVec, provider.model, maxResults * 3, sourceFilter)
        .map((r) => ({
          path: r.path, startLine: r.startLine, endLine: r.endLine,
          score: r.score, snippet: truncateUtf16Safe(r.text, SNIPPET_MAX_CHARS), source: r.source as MemorySource,
        }));
    }

    // Apply temporal decay
    results = await applyTemporalDecay({
      results,
      config: this.config.query.temporalDecay,
      workspaceDir: this.memoryDir,
    });

    // Re-sort after decay
    results.sort((a, b) => b.score - a.score);

    // Apply MMR re-ranking
    if (this.config.query.mmr.enabled) {
      results = applyMMRToResults(results, this.config.query.mmr);
    }

    return results.filter((r) => r.score >= minScore).slice(0, maxResults);
  }

  private buildSourceFilter(): { sql: string; params: string[] } {
    const sources = this.config.sources;
    if (sources.length === 0 || sources.length >= 2) return { sql: "", params: [] };
    return { sql: " AND source = ?", params: [sources[0]!] };
  }

  private searchVector(
    queryVec: number[], providerModel: string, limit: number,
    sourceFilter: { sql: string; params: string[] },
  ): Array<{ id: string; path: string; startLine: number; endLine: number; score: number; text: string; source: string }> {
    const rows = this.db.prepare(
      `SELECT id, path, start_line, end_line, text, embedding, source FROM chunks WHERE model = ?${sourceFilter.sql}`,
    ).all(providerModel, ...sourceFilter.params) as Array<{
      id: string; path: string; start_line: number; end_line: number; text: string; embedding: string; source: string;
    }>;
    return rows
      .map((row) => ({
        id: row.id, path: row.path, startLine: row.start_line, endLine: row.end_line,
        text: row.text, source: row.source,
        score: cosineSimilarity(queryVec, parseEmbedding(row.embedding)),
      }))
      .filter((e) => Number.isFinite(e.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private searchFts(
    query: string, providerModel: string | undefined, limit: number,
    sourceFilter: { sql: string; params: string[] },
  ): Array<{ id: string; path: string; startLine: number; endLine: number; textScore: number; text: string; source: string }> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const modelClause = providerModel ? " AND model = ?" : "";
    const modelParams = providerModel ? [providerModel] : [];
    try {
      const rows = this.db.prepare(
        `SELECT id, path, source, start_line, end_line, text, bm25(chunks_fts) AS rank
         FROM chunks_fts WHERE chunks_fts MATCH ?${modelClause}${sourceFilter.sql} ORDER BY rank ASC LIMIT ?`,
      ).all(ftsQuery, ...modelParams, ...sourceFilter.params, limit) as Array<{
        id: string; path: string; source: string; start_line: number; end_line: number; text: string; rank: number;
      }>;
      return rows.map((row) => ({
        id: row.id, path: row.path, startLine: row.start_line, endLine: row.end_line,
        textScore: bm25RankToScore(row.rank), text: row.text, source: row.source,
      }));
    } catch { return []; }
  }

  private mergeHybridResults(
    vectorResults: Array<{ id: string; path: string; startLine: number; endLine: number; score: number; text: string; source: string }>,
    ftsResults: Array<{ id: string; path: string; startLine: number; endLine: number; textScore: number; text: string; source: string }>,
  ): MemorySearchResult[] {
    const { vectorWeight, textWeight } = this.config.query.hybrid;
    const byId = new Map<string, { path: string; startLine: number; endLine: number; source: string; text: string; vectorScore: number; textScore: number }>();
    for (const r of vectorResults) byId.set(r.id, { path: r.path, startLine: r.startLine, endLine: r.endLine, source: r.source, text: r.text, vectorScore: r.score, textScore: 0 });
    for (const r of ftsResults) {
      const existing = byId.get(r.id);
      if (existing) { existing.textScore = r.textScore; }
      else byId.set(r.id, { path: r.path, startLine: r.startLine, endLine: r.endLine, source: r.source, text: r.text, vectorScore: 0, textScore: r.textScore });
    }
    return Array.from(byId.values())
      .map((e) => ({
        path: e.path, startLine: e.startLine, endLine: e.endLine,
        score: vectorWeight * e.vectorScore + textWeight * e.textScore,
        snippet: truncateUtf16Safe(e.text, SNIPPET_MAX_CHARS), source: e.source as MemorySource,
      }))
      .sort((a, b) => b.score - a.score);
  }

  // -------------------------------------------------------------------------
  // Read file (for memory_get tool)
  // -------------------------------------------------------------------------

  async readFile(params: { relPath: string; from?: number; lines?: number }): Promise<{ text: string; path: string }> {
    const rawPath = params.relPath.trim();
    if (!rawPath) throw new Error("path required");
    const absPath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(this.memoryDir, rawPath);
    const relPath = path.relative(this.memoryDir, absPath).replace(/\\/g, "/");
    const inWorkspace = relPath.length > 0 && !relPath.startsWith("..") && !path.isAbsolute(relPath);
    if (!inWorkspace || !isMemoryPath(relPath)) throw new Error("path must be within memory directory");
    if (!absPath.endsWith(".md")) throw new Error("only .md files are supported");
    let content: string;
    try { content = await fs.readFile(absPath, "utf-8"); } catch { return { text: "", path: relPath }; }
    if (!params.from && !params.lines) return { text: content, path: relPath };
    const fileLines = content.split("\n");
    const start = Math.max(1, params.from ?? 1);
    const count = Math.max(1, params.lines ?? fileLines.length);
    return { text: fileLines.slice(start - 1, start - 1 + count).join("\n"), path: relPath };
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  status(): MemoryStatus {
    // Single grouped query for per-source counts (replaces 2*N separate queries)
    const filesBySource = this.db.prepare("SELECT source, COUNT(*) as c FROM files GROUP BY source").all() as Array<{ source: string; c: number }>;
    const chunksBySource = this.db.prepare("SELECT source, COUNT(*) as c FROM chunks GROUP BY source").all() as Array<{ source: string; c: number }>;
    const cacheCount = (this.db.prepare("SELECT COUNT(*) as c FROM embedding_cache").get() as { c: number })?.c ?? 0;

    const fileMap = new Map(filesBySource.map((r) => [r.source, r.c]));
    const chunkMap = new Map(chunksBySource.map((r) => [r.source, r.c]));
    let fileCount = 0, chunkCount = 0;
    const sourceCounts: Array<{ source: MemorySource; files: number; chunks: number }> = [];
    for (const source of this.config.sources) {
      const f = fileMap.get(source) ?? 0;
      const c = chunkMap.get(source) ?? 0;
      sourceCounts.push({ source, files: f, chunks: c });
      fileCount += f;
      chunkCount += c;
    }

    return {
      enabled: this.config.enabled,
      provider: this.provider?.id ?? "none",
      model: this.provider?.model ?? "fts-only",
      searchMode: this.searchMode,
      ...(this.fallbackFrom ? { fallback: { from: this.fallbackFrom, reason: this.fallbackReason ?? "" } } : {}),
      files: fileCount, chunks: chunkCount, dirty: this.dirty,
      sources: [...this.config.sources], sourceCounts,
      fts: { enabled: this.config.query.hybrid.enabled || !this.provider, available: this.ftsAvailable },
      cache: { enabled: !!this.provider, entries: cacheCount },
      citations: this.config.citations,
    };
  }
}
