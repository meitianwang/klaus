import type { ProviderDefinition } from "./types.js";

export const openaiCodexProvider: ProviderDefinition = {
  id: "openai-codex",
  label: "OpenAI Codex",
  protocol: "openai-codex",
  defaultBaseUrl: "",
  auth: { envVar: "OPENAI_CODEX_TOKEN", label: "JWT Token" },
  models: [
    { id: "codex-mini-latest", label: "Codex Mini (latest)", tokens: 192000 },
    { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", tokens: 192000 },
    { id: "gpt-5.1", label: "GPT-5.1", tokens: 192000 },
    { id: "gpt-5.2", label: "GPT-5.2", tokens: 192000 },
    { id: "gpt-5.3", label: "GPT-5.3", tokens: 192000 },
    { id: "gpt-5.4", label: "GPT-5.4", tokens: 192000 },
  ],
};
