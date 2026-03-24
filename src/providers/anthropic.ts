import type { ProviderDefinition } from "./types.js";
import { fetchAnthropicModels } from "./catalog-utils.js";

export const anthropicProvider: ProviderDefinition = {
  id: "anthropic",
  label: "Anthropic",
  protocol: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  auth: { method: { type: "api_key", label: "API Key" } },
  models: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", tokens: 200000 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tokens: 200000 },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", tokens: 200000 },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tokens: 200000 },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tokens: 200000 },
  ],
  catalog: (apiKey, baseUrl) =>
    fetchAnthropicModels(apiKey!, baseUrl || "https://api.anthropic.com"),
};
