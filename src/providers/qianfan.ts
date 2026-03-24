import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const qianfanProvider: ProviderDefinition = {
  id: "qianfan",
  label: "Qianfan (百度千帆)",
  protocol: "openai",
  defaultBaseUrl: "https://qianfan.baidubce.com/v2",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "deepseek-v3.2", label: "DeepSeek V3.2", tokens: 98304 },
    { id: "ernie-5.0-thinking-preview", label: "ERNIE 5.0 Thinking", tokens: 119000 },
    { id: "ernie-4.5-128k", label: "ERNIE 4.5 128K", tokens: 131072 },
    { id: "ernie-4.5-8k", label: "ERNIE 4.5 8K", tokens: 8192 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://qianfan.baidubce.com/v2", {
      defaultTokens: 32768,
    }),
};
