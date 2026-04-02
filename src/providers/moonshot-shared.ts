import type { ModelPreset, ProviderAuth } from "./types.js";
import type { AgentTool } from "../klaus-agent-compat.js";
import { createKimiWebSearchTool } from "../tools/kimi-web-search.js";
import { createMoonshotVideoTool } from "../tools/moonshot-video.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const MOONSHOT_MODELS: readonly ModelPreset[] = [
  { id: "kimi-k2.5", label: "Kimi K2.5", tokens: 262144 },
  { id: "kimi-k2-thinking", label: "Kimi K2 Thinking", tokens: 262144 },
  { id: "kimi-k2-thinking-turbo", label: "Kimi K2 Thinking Turbo", tokens: 262144 },
  { id: "kimi-k2-turbo", label: "Kimi K2 Turbo", tokens: 256000 },
];

export const moonshotAuth: ProviderAuth = { method: { type: "api_key", label: "API Key" } };

export function moonshotTools(apiKey: string, baseUrl: string, model: string): AgentTool[] {
  return [
    createKimiWebSearchTool(apiKey, baseUrl, model),
    createMoonshotVideoTool(apiKey, baseUrl, model),
  ];
}

export function moonshotCatalog(defaultBaseUrl: string) {
  return (apiKey?: string, baseUrl?: string) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || defaultBaseUrl, {
      includePrefix: ["kimi-", "moonshot-", "k2"],
      defaultTokens: 262144,
    });
}
