import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const volcengineProvider: ProviderDefinition = {
  id: "volcengine",
  label: "Volcengine (豆包)",
  protocol: "openai",
  defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "doubao-1.5-pro-256k", label: "Doubao 1.5 Pro 256K", tokens: 256000 },
    { id: "doubao-1.5-pro-32k", label: "Doubao 1.5 Pro 32K", tokens: 32000 },
    { id: "doubao-1.5-lite-32k", label: "Doubao 1.5 Lite 32K", tokens: 32000 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://ark.cn-beijing.volces.com/api/v3", {
      includePrefix: ["doubao-"],
      defaultTokens: 32000,
    }),
};
