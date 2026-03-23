import type { ModelPreset, ProviderDefinition } from "./types.js";
import type { LLMProviderFactory, AgentTool } from "klaus-agent";
import { MoonshotProvider } from "./moonshot.js";
import { createKimiWebSearchTool } from "../tools/kimi-web-search.js";
import { createMoonshotVideoTool } from "../tools/moonshot-video.js";

export const MOONSHOT_MODELS: readonly ModelPreset[] = [
  { id: "kimi-k2.5", label: "Kimi K2.5", tokens: 262144 },
  { id: "kimi-k2-thinking", label: "Kimi K2 Thinking", tokens: 262144 },
  { id: "kimi-k2-thinking-turbo", label: "Kimi K2 Thinking Turbo", tokens: 262144 },
  { id: "kimi-k2-turbo", label: "Kimi K2 Turbo", tokens: 256000 },
];

export const moonshotFactory: LLMProviderFactory = (c) =>
  new MoonshotProvider(c.apiKey, c.baseUrl);

export function moonshotTools(apiKey: string, baseUrl: string, model: string): AgentTool[] {
  return [
    createKimiWebSearchTool(apiKey, baseUrl, model),
    createMoonshotVideoTool(apiKey, baseUrl, model),
  ];
}
