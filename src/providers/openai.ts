import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

const KNOWN_TOKENS: Record<string, number> = {
  "gpt-5.4": 1050000, "gpt-5.4-mini": 1050000, "gpt-5.4-nano": 1050000,
  "gpt-5.2": 1050000, "gpt-4.1": 1047576, "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576, "o3": 200000, "o4-mini": 200000,
};

export const openaiProvider: ProviderDefinition = {
  id: "openai",
  label: "OpenAI",
  protocol: "openai",
  defaultBaseUrl: "https://api.openai.com/v1",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "gpt-5.4", label: "GPT-5.4", tokens: 1050000 },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", tokens: 1050000 },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", tokens: 1050000 },
    { id: "gpt-5.2", label: "GPT-5.2", tokens: 1050000 },
    { id: "gpt-4.1", label: "GPT-4.1", tokens: 1047576 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tokens: 1047576 },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", tokens: 1047576 },
    { id: "o3", label: "o3", tokens: 200000 },
    { id: "o4-mini", label: "o4-mini", tokens: 200000 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.openai.com/v1", {
      includePrefix: ["gpt-", "o1", "o3", "o4", "chatgpt-"],
      knownTokens: KNOWN_TOKENS,
    }),
};
