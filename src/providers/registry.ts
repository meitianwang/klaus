import type { ProviderDefinition } from "./types.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiProvider } from "./openai.js";
import { openaiResponsesProvider } from "./openai-responses.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { googleProvider } from "./google.js";
import { moonshotProvider } from "./moonshot-def.js";
import { moonshotCnProvider } from "./moonshot-cn.js";

const ALL_PROVIDERS: readonly ProviderDefinition[] = [
  anthropicProvider,
  openaiProvider,
  openaiResponsesProvider,
  openaiCodexProvider,
  googleProvider,
  moonshotProvider,
  moonshotCnProvider,
];

const byId = new Map<string, ProviderDefinition>(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

export function getAllProviders(): readonly ProviderDefinition[] {
  return ALL_PROVIDERS;
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return byId.get(id);
}
