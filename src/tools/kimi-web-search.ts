/**
 * Kimi Web Search tool — uses Moonshot's native $web_search via multi-round chat.
 * Ported from openclaw's kimi-web-search-provider.ts, adapted for klaus-agent's AgentTool interface.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult, ToolExecutionContext } from "../klaus-agent-compat.js";
import { fetchMoonshotApi } from "./moonshot-fetch.js";

const KIMI_WEB_SEARCH_TOOL = {
  type: "builtin_function",
  function: { name: "$web_search" },
} as const;

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({ description: "Number of results to return (1-10).", minimum: 1, maximum: 10 }),
  ),
});

type SearchParams = Static<typeof SearchParams>;

type KimiToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type KimiMessage = {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: KimiToolCall[];
};

type KimiSearchResponse = {
  choices?: Array<{ finish_reason?: string; message?: KimiMessage }>;
  search_results?: Array<{ title?: string; url?: string; content?: string }>;
};

function extractCitations(data: KimiSearchResponse): string[] {
  const citations = (data.search_results ?? [])
    .map((e) => e.url?.trim())
    .filter((url): url is string => Boolean(url));

  for (const tc of data.choices?.[0]?.message?.tool_calls ?? []) {
    if (!tc.function?.arguments) continue;
    try {
      const parsed = JSON.parse(tc.function.arguments) as {
        search_results?: Array<{ url?: string }>;
        url?: string;
      };
      if (parsed.url?.trim()) citations.push(parsed.url.trim());
      for (const r of parsed.search_results ?? []) {
        if (r.url?.trim()) citations.push(r.url.trim());
      }
    } catch { /* ignore malformed */ }
  }
  return [...new Set(citations)];
}

function extractText(message: KimiMessage | undefined): string | undefined {
  return message?.content?.trim() || message?.reasoning_content?.trim() || undefined;
}

function buildToolResultContent(data: KimiSearchResponse): string {
  return JSON.stringify({
    search_results: (data.search_results ?? []).map((e) => ({
      title: e.title ?? "",
      url: e.url ?? "",
      content: e.content ?? "",
    })),
  });
}

async function runKimiSearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
}): Promise<{ content: string; citations: string[] }> {
  const messages: Array<Record<string, unknown>> = [{ role: "user", content: params.query }];
  const allCitations = new Set<string>();

  for (let round = 0; round < 3; round++) {
    const data = await fetchMoonshotApi<KimiSearchResponse>({
      baseUrl: params.baseUrl,
      path: "/chat/completions",
      apiKey: params.apiKey,
      body: { model: params.model, messages, tools: [KIMI_WEB_SEARCH_TOOL] },
      signal: params.signal,
    });
    for (const c of extractCitations(data)) allCitations.add(c);

    const choice = data.choices?.[0];
    const message = choice?.message;
    const text = extractText(message);
    const toolCalls = message?.tool_calls ?? [];

    if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
      return { content: text ?? "No response", citations: [...allCitations] };
    }

    // Continue multi-round: push assistant + tool results
    messages.push({
      role: "assistant",
      content: message?.content ?? "",
      ...(message?.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      tool_calls: toolCalls,
    });

    const toolContent = buildToolResultContent(data);
    let pushed = false;
    for (const tc of toolCalls) {
      if (!tc.id?.trim()) continue;
      pushed = true;
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
    }
    if (!pushed) {
      return { content: text ?? "No response", citations: [...allCitations] };
    }
  }

  return { content: "Search completed but no final answer was produced.", citations: [...allCitations] };
}

export function createKimiWebSearchTool(apiKey: string, baseUrl: string, model: string): AgentTool {
  return {
    name: "kimi_web_search",
    label: "Kimi Web Search",
    description:
      "Search the web using Kimi by Moonshot. Returns AI-synthesized answers with citations from native $web_search.",
    parameters: SearchParams,
    async execute(
      _toolCallId: string,
      params: SearchParams,
      context: ToolExecutionContext,
    ): Promise<AgentToolResult> {
      const result = await runKimiSearch({
        query: params.query,
        apiKey,
        baseUrl,
        model,
        signal: context.signal,
      });

      const citationText = result.citations.length > 0
        ? `\n\nSources:\n${result.citations.map((u) => `- ${u}`).join("\n")}`
        : "";

      return {
        content: [{ type: "text", text: result.content + citationText }],
      };
    },
  };
}
