import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const kimiCodingProvider: ProviderDefinition = {
  id: "kimi-coding",
  label: "Kimi Coding",
  protocol: "anthropic",
  defaultBaseUrl: "https://api.kimi.com/coding",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "kimi-code", label: "Kimi Code", tokens: 262144 },
    { id: "k2p5", label: "Kimi Code (K2.5)", tokens: 262144 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.kimi.com/coding", {
      includePrefix: ["kimi-", "k2"],
      defaultTokens: 262144,
    }),
};
