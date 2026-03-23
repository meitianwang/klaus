import type { ProviderDefinition } from "./types.js";

export const anthropicProvider: ProviderDefinition = {
  id: "anthropic",
  label: "Anthropic",
  protocol: "anthropic",
  defaultBaseUrl: "",
  auth: { envVar: "ANTHROPIC_API_KEY", label: "API Key" },
  models: [
    { id: "claude-opus-4-20250514", label: "Claude Opus 4", tokens: 200000 },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", tokens: 200000 },
    { id: "claude-haiku-4-20250514", label: "Claude Haiku 4", tokens: 200000 },
  ],
};
