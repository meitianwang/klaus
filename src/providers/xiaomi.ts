import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const xiaomiProvider: ProviderDefinition = {
  id: "xiaomi",
  label: "Xiaomi (小米)",
  protocol: "openai",
  defaultBaseUrl: "https://api.xiaomimimo.com/v1",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "mimo-v2-pro", label: "MiMo V2 Pro", tokens: 1048576 },
    { id: "mimo-v2-omni", label: "MiMo V2 Omni", tokens: 262144 },
    { id: "mimo-v2-flash", label: "MiMo V2 Flash", tokens: 262144 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.xiaomimimo.com/v1", {
      includePrefix: ["mimo-"],
      defaultTokens: 262144,
    }),
};
