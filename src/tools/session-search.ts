/**
 * Session Search — 跨会话搜索工具。
 *
 * 让 agent 按关键词检索当前用户的历史对话 transcript，返回匹配摘要。
 * 通过 buildTool() 注册为引擎工具，在 agent-manager.ts 的 buildTools() 中注入。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import { buildTool } from "../engine/Tool.js";
import { getScopedUserId } from "../engine/bootstrap/state.js";
import { getUserTranscriptsDir } from "../user-dirs.js";
import { lazySchema } from "../engine/utils/lazySchema.js";
import { sideQuery } from "../engine/utils/sideQuery.js";
import { getDefaultHaikuModel } from "../engine/utils/model/model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  sessionId: string;
  time: string;
  excerpts: string[];
}

interface TranscriptLine {
  type: string;
  role?: string;
  content?: string | { type: string; text?: string }[];
  ts?: number;
  sessionKey?: string;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Search logic
// ---------------------------------------------------------------------------

function extractText(content: string | { type: string; text?: string }[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function searchFile(
  lines: TranscriptLine[],
  keywords: string[],
): { score: number; matches: { text: string; role: string }[] } {
  const messages: { text: string; role: string }[] = [];
  for (const line of lines) {
    if (line.type === "message" && line.role) {
      messages.push({ text: extractText(line.content), role: line.role });
    }
  }

  const matchIndices = new Set<number>();
  let totalScore = 0;
  for (let i = 0; i < messages.length; i++) {
    const lower = messages[i].text.toLowerCase();
    let msgScore = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) msgScore++;
    }
    if (msgScore > 0) {
      matchIndices.add(i);
      totalScore += msgScore;
    }
  }

  if (matchIndices.size === 0) return { score: 0, matches: [] };

  // Context: 3 messages before/after each match
  const contextIndices = new Set<number>();
  for (const idx of matchIndices) {
    for (let j = Math.max(0, idx - 3); j <= Math.min(messages.length - 1, idx + 3); j++) {
      contextIndices.add(j);
    }
  }

  const sorted = [...contextIndices].sort((a, b) => a - b);
  return {
    score: totalScore,
    matches: sorted.map((idx) => {
      const m = messages[idx];
      return { text: m.text.length > 300 ? m.text.slice(0, 300) + "..." : m.text, role: m.role };
    }),
  };
}

async function searchSessions(
  userId: string,
  query: string,
  maxResults = 5,
): Promise<SearchResult[]> {
  const dir = getUserTranscriptsDir(userId);
  let files: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl") && !e.name.startsWith("."))
      .map((e) => e.name)
      .slice(-100);
  } catch {
    return [];
  }

  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (keywords.length === 0) return [];

  const scored: { file: string; score: number; excerpts: string[]; time: string }[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(join(dir, file), "utf-8");
    } catch {
      continue;
    }
    const lines: TranscriptLine[] = [];
    let sessionTime = "";
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as TranscriptLine;
        lines.push(parsed);
        if (parsed.type === "session" && parsed.createdAt) {
          sessionTime = new Date(parsed.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
        }
      } catch { /* skip */ }
    }
    const result = searchFile(lines, keywords);
    if (result.score > 0) {
      scored.push({
        file: file.replace(".jsonl", ""),
        score: result.score,
        excerpts: result.matches.slice(0, 10).map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.text}`),
        time: sessionTime,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((s) => ({
    sessionId: s.file,
    time: s.time,
    excerpts: s.excerpts,
  }));
}

// ---------------------------------------------------------------------------
// LLM summarization via sideQuery + Haiku
// ---------------------------------------------------------------------------

const SUMMARIZE_PROMPT = `用一两句话总结这段对话的核心内容：用户想做什么、结果如何、有什么关键发现。只输出总结，不要其他内容。`;

async function summarizeExcerpts(
  excerpts: string[],
  signal: AbortSignal,
): Promise<string> {
  const text = excerpts.join("\n");
  // Too short to bother summarizing
  if (text.length < 200) return text;
  try {
    const result = await sideQuery({
      model: getDefaultHaikuModel(),
      system: SUMMARIZE_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [{ role: "user", content: text.slice(0, 8000) }],
      max_tokens: 256,
      signal,
      querySource: "session_search_summary" as any,
    });
    const block = result.content.find((b) => b.type === "text");
    if (block && block.type === "text" && block.text.trim()) {
      return block.text.trim();
    }
  } catch {
    // Summarization failed — fall back to raw excerpts
  }
  return text;
}

// ---------------------------------------------------------------------------
// Tool registration via buildTool()
// ---------------------------------------------------------------------------

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().describe("搜索关键词（空格分隔多个词，取并集匹配）"),
    limit: z.number().optional().describe("最大返回会话数（默认 5）"),
  }),
);

export const SessionSearchTool = buildTool({
  name: "SessionSearch",
  searchHint: "search past conversations history recall",
  maxResultSizeChars: 50_000,
  async prompt() {
    return "搜索当前用户的历史对话记录。当用户提到过去的对话、或遇到似曾相识的问题时使用。";
  },
  async description() {
    return "搜索当前用户的历史对话记录。当用户提到过去的对话、或遇到似曾相识的问题时使用。输入搜索关键词，返回匹配的历史会话摘要。";
  },
  get inputSchema() {
    return inputSchema();
  },
  isReadOnly() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  async call(input, context) {
    const userId = getScopedUserId();
    if (!userId) {
      return { data: { text: "Error: no user context available." } };
    }
    const results = await searchSessions(userId, input.query, input.limit ?? 5);
    if (results.length === 0) {
      return { data: { text: "未找到匹配的历史对话。" } };
    }
    // Summarize each session's excerpts in parallel via Haiku
    const signal = context?.abortController?.signal ?? new AbortController().signal;
    const summaries = await Promise.all(
      results.map(async (r) => {
        const summary = await summarizeExcerpts(r.excerpts, signal);
        return `**${r.sessionId}** (${r.time})\n${summary}`;
      }),
    );
    return { data: { text: summaries.join("\n\n---\n\n") } };
  },
  mapToolResultToToolResultBlockParam(output: { text: string }, toolUseID: string) {
    return {
      tool_use_id: toolUseID,
      type: "tool_result" as const,
      content: output.text,
    };
  },
});
