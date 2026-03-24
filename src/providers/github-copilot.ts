import type { ProviderDefinition } from "./types.js";
import { fetchOpenAICompatibleModels } from "./catalog-utils.js";

export const githubCopilotProvider: ProviderDefinition = {
  id: "github-copilot",
  label: "GitHub Copilot",
  protocol: "anthropic",
  defaultBaseUrl: "https://api.githubcopilot.com",
  auth: { method: { type: "api_key", label: "GitHub Token" } },
  models: [
    { id: "claude-sonnet-4", label: "Claude Sonnet 4 (Copilot)", tokens: 200000 },
    { id: "gpt-4.1", label: "GPT-4.1 (Copilot)", tokens: 128000 },
    { id: "o3-mini", label: "o3-mini (Copilot)", tokens: 200000 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchOpenAICompatibleModels(apiKey!, baseUrl || "https://api.githubcopilot.com", {
      defaultTokens: 128000,
    }),
};
