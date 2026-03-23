import type { ProviderDefinition } from "./types.js";

export const openaiProvider: ProviderDefinition = {
  id: "openai",
  label: "OpenAI",
  protocol: "openai",
  defaultBaseUrl: "",
  auth: { envVar: "OPENAI_API_KEY", label: "API Key" },
  models: [
    { id: "gpt-4.1", label: "GPT-4.1", tokens: 1047576 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tokens: 1047576 },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", tokens: 1047576 },
    { id: "o3", label: "o3", tokens: 200000 },
    { id: "o4-mini", label: "o4-mini", tokens: 200000 },
  ],
};
