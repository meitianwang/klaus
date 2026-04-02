import type { ProviderDefinition } from "./types.js";
import { MOONSHOT_MODELS, moonshotAuth, moonshotTools, moonshotCatalog } from "./moonshot-shared.js";

export const moonshotCnProvider: ProviderDefinition = {
  id: "moonshot-cn",
  label: "Moonshot (.cn)",
  protocol: "moonshot-cn",
  defaultBaseUrl: "https://api.moonshot.cn/v1",
  models: MOONSHOT_MODELS,
  auth: moonshotAuth,
  tools: moonshotTools,
  catalog: moonshotCatalog("https://api.moonshot.cn/v1"),
};
