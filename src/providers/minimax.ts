import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const minimaxProvider: ProviderDefinition = {
  id: "minimax",
  label: "MiniMax",
  protocol: "anthropic",
  defaultBaseUrl: "https://api.minimax.io/anthropic",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "MiniMax-M1", label: "MiniMax M1", tokens: 1000000 },
    { id: "MiniMax-T1", label: "MiniMax T1", tokens: 1000000 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.minimax.io/anthropic", {
      defaultTokens: 1000000,
    }),
};
