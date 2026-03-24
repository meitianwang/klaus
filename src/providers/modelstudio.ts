import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const modelstudioProvider: ProviderDefinition = {
  id: "modelstudio",
  label: "ModelStudio (阿里百炼)",
  protocol: "openai",
  defaultBaseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "qwen3.5-plus", label: "Qwen 3.5 Plus", tokens: 1000000 },
    { id: "qwen3-coder-plus", label: "Qwen 3 Coder Plus", tokens: 1000000 },
    { id: "qwen3-coder-next", label: "Qwen 3 Coder Next", tokens: 262144 },
    { id: "qwen3-max-2026-01-23", label: "Qwen 3 Max", tokens: 262144 },
    { id: "MiniMax-M2.5", label: "MiniMax M2.5", tokens: 1000000 },
    { id: "glm-5", label: "GLM 5", tokens: 202752 },
    { id: "kimi-k2.5", label: "Kimi K2.5", tokens: 262144 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://coding-intl.dashscope.aliyuncs.com/v1", {
      defaultTokens: 131072,
    }),
};
