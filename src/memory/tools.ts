/**
 * Memory tools — memory_search and memory_get for klaus-agent.
 * Aligned with OpenClaw's memory-tool.ts / memory-core plugin.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult, ToolExecutionContext } from "klaus-agent";
import type { MemoryManager } from "./manager.js";
import type { MemoryCitationsMode, MemorySearchResult } from "./types.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MemorySearchParams = Type.Object({
  query: Type.String({ description: "Semantic search query for memory files." }),
  maxResults: Type.Optional(Type.Number({ description: "Max results to return (default 6)." })),
  minScore: Type.Optional(Type.Number({ description: "Minimum similarity score (default 0.35)." })),
});

type MemorySearchParams = Static<typeof MemorySearchParams>;

const MemoryGetParams = Type.Object({
  path: Type.String({ description: "Relative path to a memory file (e.g. MEMORY.md or memory/notes.md)." }),
  from: Type.Optional(Type.Number({ description: "Start line number (1-indexed)." })),
  lines: Type.Optional(Type.Number({ description: "Number of lines to read." })),
});

type MemoryGetParams = Static<typeof MemoryGetParams>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResult(data: unknown): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange =
    entry.startLine === entry.endLine
      ? `#L${entry.startLine}`
      : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) {
    return results.map((entry) => ({ ...entry, citation: undefined }));
  }
  return results.map((entry) => {
    const citation = formatCitation(entry);
    return {
      ...entry,
      citation,
      snippet: `${entry.snippet.trim()}\n\nSource: ${citation}`,
    };
  });
}

function buildMemorySearchUnavailableResult(error: string | undefined) {
  const reason = (error ?? "memory search unavailable").trim() || "memory search unavailable";
  const isQuotaError = /insufficient_quota|quota|429/.test(reason.toLowerCase());
  return {
    results: [],
    disabled: true,
    unavailable: true,
    error: reason,
    warning: isQuotaError
      ? "Memory search is unavailable because the embedding provider quota is exhausted."
      : "Memory search is unavailable due to an embedding/provider error.",
    action: isQuotaError
      ? "Top up or switch embedding provider, then retry memory_search."
      : "Check embedding provider configuration and retry memory_search.",
  };
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createMemorySearchTool(manager: MemoryManager): AgentTool {
  return {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchParams,
    async execute(
      _toolCallId: string,
      params: MemorySearchParams,
      _context: ToolExecutionContext,
    ): Promise<AgentToolResult> {
      try {
        const rawResults = await manager.search(params.query, {
          maxResults: params.maxResults,
          minScore: params.minScore,
        });
        const status = manager.status();
        const citationsMode = status.citations;
        const includeCitations = citationsMode !== "off";
        const decorated = decorateCitations(rawResults, includeCitations);

        return jsonResult({
          results: decorated,
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
          citations: citationsMode,
          mode: status.searchMode,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(buildMemorySearchUnavailableResult(message));
      }
    },
  };
}

export function createMemoryGetTool(manager: MemoryManager): AgentTool {
  return {
    name: "memory_get",
    label: "Memory Get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetParams,
    async execute(
      _toolCallId: string,
      params: MemoryGetParams,
      _context: ToolExecutionContext,
    ): Promise<AgentToolResult> {
      try {
        const result = await manager.readFile({
          relPath: params.path,
          from: params.from,
          lines: params.lines,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: params.path, text: "", disabled: true, error: message });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// System prompt section — aligned with OpenClaw's memory-core plugin
// ---------------------------------------------------------------------------

export function buildMemoryPromptSection(citationsMode: MemoryCitationsMode): string {
  const lines = [
    "## Memory Recall",
    "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.",
  ];
  if (citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push(
    "",
    "## Memory Save",
    "Proactively use memory_save to persist durable information across sessions:",
    "- Decisions made and their rationale",
    "- User preferences and workflow patterns",
    "- Key facts, names, dates, project context",
    "- Bug causes and fixes worth remembering",
    "- Architecture decisions and trade-offs",
    "Do NOT save: routine greetings, trivial exchanges, information already in memory files.",
    "Memory is automatically flushed before context compaction, but save important facts early rather than waiting.",
    "",
  );
  return lines.join("\n");
}
