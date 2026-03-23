import type { ProviderDefinition } from "./types.js";

export const openaiResponsesProvider: ProviderDefinition = {
  id: "openai-responses",
  label: "OpenAI Responses",
  protocol: "openai-responses",
  defaultBaseUrl: "",
  models: [
    { id: "gpt-4.1", label: "GPT-4.1", tokens: 1047576 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tokens: 1047576 },
    { id: "o3", label: "o3", tokens: 200000 },
    { id: "o4-mini", label: "o4-mini", tokens: 200000 },
  ],
};
