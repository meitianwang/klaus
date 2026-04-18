/**
 * Message persistence: appends user/assistant messages as JSONL transcripts.
 * Each sessionKey maps to one `.jsonl` file under ~/.klaus/transcripts/.
 *
 * Format (one JSON object per line):
 *   {"type":"session","sessionKey":"web:abc:uuid","createdAt":1709654400000}
 *   {"type":"message","role":"user","content":"hello","ts":1709654401000}
 *   {"type":"message","role":"assistant","content":"hi!","ts":1709654405000}
 *
 * Inspired by OpenClaw's JSONL transcript approach, simplified for Klaus
 * (no parentId chains, no compaction, no vector DB).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import { extractUserId, getUserTranscriptsDir } from "./user-dirs.js";
import type { TranscriptsConfig } from "./types.js";

function emitTranscriptEvent(_sessionFile: string, _sessionKey: string): void {
  // Old memory system transcript events removed — engine handles memory via three-layer system
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptSessionLine {
  readonly type: "session";
  readonly sessionKey: string;
  readonly createdAt: number;
}

/** A structured content block for rich assistant messages. */
export interface TranscriptThinkingBlock {
  readonly type: "thinking";
  readonly text: string;
  readonly durationSec?: number;
}

export interface TranscriptToolBlock {
  readonly type: "tool";
  readonly toolName: string;
  readonly toolUseId: string;
  readonly display?: string;
  readonly isError?: boolean;
}

export type TranscriptContentBlock =
  | { readonly type: "text"; readonly text: string }
  | TranscriptThinkingBlock
  | TranscriptToolBlock;

interface TranscriptMessage {
  readonly type: "message";
  readonly role: "user" | "assistant";
  readonly content: string | readonly TranscriptContentBlock[];
  readonly ts: number;
}

interface SessionSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
}

/** Context collapse commit entry — persisted to JSONL for session restore. */
interface TranscriptCollapseCommit {
  readonly type: "marble-origami-commit";
  readonly collapseId: string;
  readonly summaryUuid: string;
  readonly summaryContent: string;
  readonly summary: string;
  readonly firstArchivedUuid: string;
  readonly lastArchivedUuid: string;
}

/** Context collapse snapshot — last-wins semantics on restore. */
interface TranscriptCollapseSnapshot {
  readonly type: "marble-origami-snapshot";
  readonly staged: Array<{
    startUuid: string;
    endUuid: string;
    summary: string;
    risk: number;
    stagedAt: number;
  }>;
  readonly armed: boolean;
  readonly lastSpawnTokens: number;
}

type TranscriptLine =
  | TranscriptSessionLine
  | TranscriptMessage
  | TranscriptCollapseCommit
  | TranscriptCollapseSnapshot;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS: TranscriptsConfig = {
  transcriptsDir: join(CONFIG_DIR, "transcripts"),
  maxFiles: 200,
  maxAgeDays: 30,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace `:` with `__` and strip unsafe chars for use as filename. */
function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey
    .replace(/:/g, "__")
    .replace(/\.\./g, "_") // prevent path traversal
    .replace(/[^\w.\-]/g, "_");
}

function parseSummary(raw: string, sessionId: string): SessionSummary | null {
  let createdAt = 0;
  let updatedAt = 0;
  let title = "New Chat";
  let messageCount = 0;
  let foundFirstUser = false;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === "session" && typeof parsed.createdAt === "number") {
        createdAt = parsed.createdAt;
      }
      if (parsed.type === "message") {
        messageCount++;
        const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
        if (ts > updatedAt) updatedAt = ts;
        if (
          !foundFirstUser &&
          parsed.role === "user" &&
          typeof parsed.content === "string"
        ) {
          title = parsed.content.slice(0, 50).trim() || "New Chat";
          foundFirstUser = true;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (messageCount === 0) return null;
  return {
    sessionId,
    title,
    createdAt: createdAt || updatedAt,
    updatedAt,
    messageCount,
  };
}

function parseMessages(raw: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (
        parsed.type === "message" &&
        (parsed.role === "user" || parsed.role === "assistant") &&
        (typeof parsed.content === "string" || Array.isArray(parsed.content))
      ) {
        messages.push({
          type: "message",
          role: parsed.role,
          content: parsed.content as string | TranscriptContentBlock[],
          ts: typeof parsed.ts === "number" ? parsed.ts : 0,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// MessageStore
// ---------------------------------------------------------------------------

export class MessageStore {
  private readonly config: TranscriptsConfig;
  /** Tracks which sessionKeys already have a file (avoids repeated existsSync). */
  private readonly knownFiles = new Set<string>();
  /** Tracks which per-user transcript dirs have been created (avoids repeated mkdirSync). */
  private readonly ensuredDirs = new Set<string>();
  /** Per-key write locks to prevent concurrent header/append races. */
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(config?: Partial<TranscriptsConfig>) {
    this.config = { ...DEFAULTS, ...config };
    // Legacy global dir is no longer auto-created; per-user dirs are created on demand
  }

  /** Resolve the JSONL file path for a given sessionKey (per-user directory). */
  private filePath(sessionKey: string): string {
    const userId = extractUserId(sessionKey);
    const dir = getUserTranscriptsDir(userId);
    if (!this.ensuredDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      this.ensuredDirs.add(dir);
    }
    return join(dir, sanitizeSessionKey(sessionKey) + ".jsonl");
  }

  /** Write the session header and line data (actual I/O, no locking). */
  private async doAppend(
    sessionKey: string,
    line: TranscriptLine,
  ): Promise<void> {
    const fp = this.filePath(sessionKey);

    // Write session header on first append
    if (!this.knownFiles.has(sessionKey)) {
      if (!existsSync(fp)) {
        const header: TranscriptSessionLine = {
          type: "session",
          sessionKey,
          createdAt: Date.now(),
        };
        await appendFile(fp, JSON.stringify(header) + "\n", "utf-8");
      }
      this.knownFiles.add(sessionKey);
    }

    await appendFile(fp, JSON.stringify(line) + "\n", "utf-8");
  }

  /** Ensure the session header line exists, then append a transcript line. */
  private appendLine(sessionKey: string, line: TranscriptLine): Promise<void> {
    // Serialize writes per sessionKey to prevent concurrent header races
    const prev = this.writeLocks.get(sessionKey) ?? Promise.resolve();
    const next = prev.then(() => this.doAppend(sessionKey, line));
    this.writeLocks.set(
      sessionKey,
      next.catch(() => {}),
    );
    return next;
  }

  /** Append a user or assistant message to the session's transcript. */
  async append(
    sessionKey: string,
    role: "user" | "assistant",
    content: string | readonly TranscriptContentBlock[],
  ): Promise<void> {
    const line: TranscriptMessage = {
      type: "message",
      role,
      content,
      ts: Date.now(),
    };
    await this.appendLine(sessionKey, line);
    // Emit transcript event for memory session indexing
    emitTranscriptEvent(this.filePath(sessionKey), sessionKey);
  }

  /** Read all messages from a session's transcript (empty array if none). */
  async readHistory(sessionKey: string): Promise<readonly TranscriptMessage[]> {
    let fp = this.filePath(sessionKey);
    // Fallback to legacy global dir if not found in per-user dir
    if (!existsSync(fp)) {
      const legacyFp = join(this.config.transcriptsDir, sanitizeSessionKey(sessionKey) + ".jsonl");
      if (existsSync(legacyFp)) { fp = legacyFp; } else { return []; }
    }
    const raw = await readFile(fp, "utf-8");
    return parseMessages(raw);
  }

  /** Prune old transcript files by age and count. Returns number of files removed. */
  prune(): number {
    const usersBase = join(CONFIG_DIR, "users");
    if (!existsSync(usersBase)) return 0;

    const maxAgeMs = this.config.maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;

    // Scan all user directories
    for (const userId of readdirSync(usersBase)) {
      const dir = join(usersBase, userId, "transcripts");
      if (!existsSync(dir)) continue;

      const files: Array<{ path: string; mtimeMs: number }> = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".jsonl")) continue;
        try {
          const fp = join(dir, name);
          files.push({ path: fp, mtimeMs: statSync(fp).mtimeMs });
        } catch {}
      }

      // Remove files older than maxAge
      const remaining: typeof files = [];
      for (const f of files) {
        if (now - f.mtimeMs > maxAgeMs) {
          try { unlinkSync(f.path); removed++; } catch { remaining.push(f); }
        } else {
          remaining.push(f);
        }
      }

      // Cap per-user file count
      if (remaining.length > this.config.maxFiles) {
        remaining.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const f of remaining.slice(this.config.maxFiles)) {
          try { unlinkSync(f.path); removed++; } catch {}
        }
      }
    }

    // Also prune legacy global dir if it exists
    const legacyDir = this.config.transcriptsDir;
    if (existsSync(legacyDir)) {
      for (const name of readdirSync(legacyDir)) {
        if (!name.endsWith(".jsonl")) continue;
        try {
          const fp = join(legacyDir, name);
          if (now - statSync(fp).mtimeMs > maxAgeMs) { unlinkSync(fp); removed++; }
        } catch {}
      }
    }

    if (removed > 0) {
      console.log(`[MessageStore] Pruned ${removed} transcript file(s)`);
    }
    return removed;
  }

  /**
   * List all sessions whose sanitized sessionKey starts with the given prefix.
   * Returns summaries sorted by updatedAt descending (newest first).
   * Capped at `limit` results (default 200).
   */
  async listSessions(
    prefix: string,
    limit: number = 200,
  ): Promise<readonly SessionSummary[]> {
    const sanitizedPrefix = sanitizeSessionKey(prefix);

    // Determine which user directories to scan
    const usersBase = join(CONFIG_DIR, "users");
    let userDirs: string[] = [];

    // Optimization: if prefix identifies a specific user, only scan that user's dir
    const userId = extractUserId(prefix);
    const targetDir = getUserTranscriptsDir(userId);
    if (existsSync(targetDir)) {
      userDirs.push(targetDir);
    } else {
      // Fallback: scan all user dirs (e.g. admin queries)
      try {
        userDirs = (await readdir(usersBase)).map((u) => join(usersBase, u, "transcripts"));
      } catch {}
    }
    // Also check legacy global dir
    if (existsSync(this.config.transcriptsDir)) {
      userDirs.push(this.config.transcriptsDir);
    }

    const tasks: Promise<SessionSummary | null>[] = [];
    for (const dir of userDirs) {
      let names: string[];
      try { names = await readdir(dir); } catch { continue; }
      const matching = names.filter(
        (n) => n.endsWith(".jsonl") && n.startsWith(sanitizedPrefix),
      );
      for (const name of matching) {
        tasks.push((async () => {
          const sessionId = name.slice(sanitizedPrefix.length, -".jsonl".length);
          if (!sessionId) return null;
          try {
            const raw = await readFile(join(dir, name), "utf-8");
            return parseSummary(raw, sessionId);
          } catch { return null; }
        })());
      }
    }

    const results = (await Promise.all(tasks)).filter(
      (s): s is SessionSummary => s !== null,
    );
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    return results.slice(0, limit);
  }

  /** Delete a session's transcript file. */
  deleteSession(sessionKey: string): boolean {
    const fp = this.filePath(sessionKey);
    if (!existsSync(fp)) return false;
    try {
      unlinkSync(fp);
      this.knownFiles.delete(sessionKey);
      this.writeLocks.delete(sessionKey);
      return true;
    } catch (err) {
      console.error("[MessageStore] Failed to delete transcript:", fp, err);
      return false;
    }
  }

  /**
   * Append a raw JSONL entry (collapse commit, snapshot, or other metadata).
   * Aligned with claude-code's sessionStorage.appendEntry().
   */
  async appendEntry(
    sessionKey: string,
    entry: TranscriptCollapseCommit | TranscriptCollapseSnapshot,
  ): Promise<void> {
    await this.appendLine(sessionKey, entry);
  }

  /**
   * Read ALL entries (messages + collapse entries) from a session's transcript.
   * Used for session restore — returns raw parsed objects so the caller can
   * reconstruct both messages and collapse state.
   */
  async readAllEntries(sessionKey: string): Promise<{
    messages: TranscriptMessage[];
    collapseCommits: TranscriptCollapseCommit[];
    collapseSnapshot: TranscriptCollapseSnapshot | null;
  }> {
    let fp = this.filePath(sessionKey);
    if (!existsSync(fp)) {
      const legacyFp = join(this.config.transcriptsDir, sanitizeSessionKey(sessionKey) + ".jsonl");
      if (existsSync(legacyFp)) { fp = legacyFp; } else {
        return { messages: [], collapseCommits: [], collapseSnapshot: null };
      }
    }

    const raw = await readFile(fp, "utf-8");
    const messages: TranscriptMessage[] = [];
    const collapseCommits: TranscriptCollapseCommit[] = [];
    let collapseSnapshot: TranscriptCollapseSnapshot | null = null;

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (parsed.type === "message" &&
            (parsed.role === "user" || parsed.role === "assistant") &&
            (typeof parsed.content === "string" || Array.isArray(parsed.content))) {
          // Content can be either a plain string (legacy / user turns) or a
          // TranscriptContentBlock[] array (new format with thinking / tool /
          // text blocks). Preserve whichever shape was on disk so the engine
          // lazy-load path doesn't strip thinking turns on session restore.
          messages.push({
            type: "message",
            role: parsed.role,
            content: parsed.content as string | TranscriptContentBlock[],
            ts: typeof parsed.ts === "number" ? parsed.ts : 0,
          });
        } else if (parsed.type === "marble-origami-commit") {
          collapseCommits.push(parsed as unknown as TranscriptCollapseCommit);
        } else if (parsed.type === "marble-origami-snapshot") {
          // Last-wins: only keep the most recent snapshot
          collapseSnapshot = parsed as unknown as TranscriptCollapseSnapshot;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return { messages, collapseCommits, collapseSnapshot };
  }

  /** No-op for now; async file writes are self-contained. */
  close(): void {
    // Reserved for future use
  }
}
