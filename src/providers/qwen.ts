import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const qwenProvider: ProviderDefinition = {
  id: "qwen",
  label: "Qwen (通义千问)",
  protocol: "openai",
  defaultBaseUrl: "https://chat.qwen.ai/api/v1",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "qwen3-235b-a22b", label: "Qwen3 235B", tokens: 131072 },
    { id: "qwen3-32b", label: "Qwen3 32B", tokens: 131072 },
    { id: "qwq-32b", label: "QwQ 32B", tokens: 131072 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://chat.qwen.ai/api/v1", {
      includePrefix: ["qwen", "qwq"],
      defaultTokens: 131072,
    }),
};
