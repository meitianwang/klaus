/**
 * Memory write tool + auto-flush — aligned with OpenClaw's memory flush mechanism.
 *
 * Two write paths:
 * 1. memory_save tool: agent can proactively save observations/decisions/preferences
 * 2. Memory flush: triggered before compaction, runs a hidden agent turn to capture durable memories
 */

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult, ToolExecutionContext } from "../klaus-agent-compat.js";

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function todayFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}.md`;
}

// ---------------------------------------------------------------------------
// Append-only write to memory/YYYY-MM-DD.md — aligned with OpenClaw
// ---------------------------------------------------------------------------

/**
 * Append content to a daily memory file. Creates the file and directory if needed.
 * This is the only write path for memory files — always append, never overwrite.
 */
async function appendToMemoryFile(memoryDir: string, content: string): Promise<string> {
  const dir = join(memoryDir, "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filename = todayFilename();
  const filePath = join(dir, filename);
  const relPath = `memory/${filename}`;

  if (existsSync(filePath)) {
    // Always prepend \n to ensure separation — avoids reading entire file just to check trailing newline
    await appendFile(filePath, "\n" + content.trim() + "\n", "utf-8");
  } else {
    await writeFile(filePath, content.trim() + "\n", "utf-8");
  }

  return relPath;
}

// ---------------------------------------------------------------------------
// memory_save tool — agent proactively saves memories
// ---------------------------------------------------------------------------

const MemorySaveParams = Type.Object({
  content: Type.String({ description: "The memory content to save (Markdown). Include context: what was decided, why, key facts." }),
  title: Type.Optional(Type.String({ description: "Short title for this memory entry." })),
});

type MemorySaveParams = Static<typeof MemorySaveParams>;

export function createMemorySaveTool(memoryDir: string): AgentTool {
  return {
    name: "memory_save",
    label: "Memory Save",
    description:
      "Save durable memories (decisions, preferences, key facts, important context) to persistent memory files. " +
      "Use this proactively when you learn something worth remembering across sessions. " +
      "Content is appended to memory/YYYY-MM-DD.md (never overwrites).",
    parameters: MemorySaveParams,
    async execute(
      _toolCallId: string,
      params: MemorySaveParams,
      _context: ToolExecutionContext,
    ): Promise<AgentToolResult> {
      const text = params.content?.trim();
      if (!text) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "content is required" }) }] };
      }

      const entry = params.title
        ? `## ${params.title}\n\n${text}`
        : text;

      try {
        const relPath = await appendToMemoryFile(memoryDir, entry);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, path: relPath }) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Memory flush prompt — injected as a hidden agent turn before compaction
// ---------------------------------------------------------------------------

export const MEMORY_FLUSH_USER_PROMPT = [
  "Pre-compaction memory flush.",
  "Review the conversation so far and save any durable memories (decisions, preferences, key facts, context) using memory_save.",
  "If nothing worth saving, reply with a single period.",
].join("\n");
