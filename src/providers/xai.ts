import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const xaiProvider: ProviderDefinition = {
  id: "xai",
  label: "xAI (Grok)",
  protocol: "openai",
  defaultBaseUrl: "https://api.x.ai/v1",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "grok-4", label: "Grok 4", tokens: 256000 },
    { id: "grok-4-fast", label: "Grok 4 Fast", tokens: 2000000 },
    { id: "grok-3", label: "Grok 3", tokens: 131072 },
    { id: "grok-3-mini", label: "Grok 3 Mini", tokens: 131072 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.x.ai/v1", {
      includePrefix: ["grok-"],
      knownTokens: { "grok-4": 256000, "grok-4-fast": 2000000, "grok-3": 131072, "grok-3-mini": 131072 },
    }),
};
