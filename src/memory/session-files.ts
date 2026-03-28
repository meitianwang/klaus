/**
 * Session file processing — ported from OpenClaw's session-files.ts.
 * Extracts user/assistant messages from JSONL transcripts for memory indexing.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { hashText } from "./internal.js";

export type SessionFileEntry = {
  path: string;
  absPath: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content: string;
  /** Maps each content line (0-indexed) to its 1-indexed JSONL source line. */
  lineMap: number[];
};

/**
 * List all .jsonl session files in a directory.
 */
export async function listSessionFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function sessionPathForFile(absPath: string): string {
  return path.join("sessions", path.basename(absPath)).replace(/\\/g, "/");
}

function normalizeSessionText(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

function extractSessionText(content: unknown): string | null {
  if (typeof content === "string") {
    const normalized = normalizeSessionText(content);
    return normalized || null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; text?: unknown };
    if (record.type !== "text" || typeof record.text !== "string") continue;
    const normalized = normalizeSessionText(record.text);
    if (normalized) parts.push(normalized);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Build a SessionFileEntry from a JSONL transcript file.
 * Extracts user/assistant message text with line mapping.
 */
export async function buildSessionEntry(absPath: string): Promise<SessionFileEntry | null> {
  try {
    const stat = await fs.stat(absPath);
    const raw = await fs.readFile(absPath, "utf-8");
    const lines = raw.split("\n");
    const collected: string[] = [];
    const lineMap: number[] = [];

    for (let jsonlIdx = 0; jsonlIdx < lines.length; jsonlIdx++) {
      const line = lines[jsonlIdx];
      if (!line?.trim()) continue;

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (!record || typeof record !== "object") continue;
      const typed = record as { type?: unknown; message?: unknown };
      if (typed.type !== "message") continue;

      const message = typed.message as { role?: unknown; content?: unknown } | undefined;
      if (!message || typeof message.role !== "string") continue;
      if (message.role !== "user" && message.role !== "assistant") continue;

      const text = extractSessionText(message.content);
      if (!text) continue;

      const label = message.role === "user" ? "User" : "Assistant";
      collected.push(`${label}: ${text}`);
      lineMap.push(jsonlIdx + 1);
    }

    const content = collected.join("\n");
    return {
      path: sessionPathForFile(absPath),
      absPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: hashText(content + "\n" + lineMap.join(",")),
      content,
      lineMap,
    };
  } catch {
    return null;
  }
}
