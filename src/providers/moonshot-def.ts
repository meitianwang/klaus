import type { ProviderDefinition } from "./types.js";
import { MOONSHOT_MODELS, moonshotFactory, moonshotTools } from "./moonshot-shared.js";

export const moonshotProvider: ProviderDefinition = {
  id: "moonshot",
  label: "Moonshot (.ai)",
  protocol: "moonshot",
  defaultBaseUrl: "https://api.moonshot.ai/v1",
  models: MOONSHOT_MODELS,
  factory: moonshotFactory,
  tools: moonshotTools,
};
