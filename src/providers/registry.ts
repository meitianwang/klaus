import type { ProviderDefinition } from "./types.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_DIR } from "../config.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiProvider } from "./openai.js";
import { openaiResponsesProvider } from "./openai-responses.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { googleProvider } from "./google.js";
import { moonshotProvider } from "./moonshot-def.js";
import { moonshotCnProvider } from "./moonshot-cn.js";
import { kimiCodingProvider } from "./kimi-coding.js";
import { volcengineProvider } from "./volcengine.js";
import { minimaxProvider } from "./minimax.js";
import { xaiProvider } from "./xai.js";
import { githubCopilotProvider } from "./github-copilot.js";
import { modelstudioProvider } from "./modelstudio.js";
import { xiaomiProvider } from "./xiaomi.js";
import { qianfanProvider } from "./qianfan.js";
import { qwenProvider } from "./qwen.js";

const providers: ProviderDefinition[] = [
  anthropicProvider,
  openaiProvider,
  openaiResponsesProvider,
  openaiCodexProvider,
  googleProvider,
  moonshotProvider,
  moonshotCnProvider,
  kimiCodingProvider,
  volcengineProvider,
  minimaxProvider,
  xaiProvider,
  githubCopilotProvider,
  modelstudioProvider,
  xiaomiProvider,
  qianfanProvider,
  qwenProvider,
];

const byId = new Map<string, ProviderDefinition>(
  providers.map((p) => [p.id, p]),
);

const BUILTIN_IDS = new Set(providers.map((p) => p.id));

export const capabilities = new CapabilityRegistry();

export function getAllProviders(): readonly ProviderDefinition[] {
  return providers;
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return byId.get(id);
}

function isValidDefinition(obj: unknown): obj is ProviderDefinition {
  if (!obj || typeof obj !== "object") return false;
  const d = obj as Record<string, unknown>;
  return typeof d.id === "string" && typeof d.label === "string"
    && typeof d.protocol === "string" && typeof d.defaultBaseUrl === "string"
    && Array.isArray(d.models);
}

export async function loadExternalProviders(): Promise<void> {
  const dir = join(CONFIG_DIR, "providers");
  if (!existsSync(dir)) return;

  const files = readdirSync(dir).filter((f) => f.endsWith(".js") && !f.includes("/") && !f.includes("\\"));
  let count = 0;

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href + `?t=${Date.now()}`);
      const def: unknown = mod.default ?? mod.provider;
      if (!isValidDefinition(def)) {
        console.warn(`[Providers] Skipping ${file}: invalid provider definition`);
        continue;
      }
      if (byId.has(def.id)) {
        console.warn(`[Providers] Skipping ${file}: duplicate id "${def.id}"`);
        continue;
      }
      providers.push(def);
      byId.set(def.id, def);
      count++;
    } catch (err) {
      console.warn(`[Providers] Failed to load ${file}:`, err);
    }
  }

  if (count > 0) {
    console.log(`[Providers] Loaded ${count} external provider(s) from ${dir}`);
  }
}

export function registerAllCapabilities(): void {
  for (const def of providers) {
    if (def.register) {
      const api = capabilities.createAPI(def.id);
      def.register(api);
    }
  }
}

export async function reloadExternalProviders(): Promise<{ added: string[]; removed: string[] }> {
  const previousExternal = providers
    .filter((p) => !BUILTIN_IDS.has(p.id))
    .map((p) => p.id);

  // Stop services and remove all external providers and their capabilities
  for (const id of previousExternal) {
    await capabilities.stopProviderServices(id);
    byId.delete(id);
    capabilities.removeProvider(id);
  }
  for (let i = providers.length - 1; i >= 0; i--) {
    if (!BUILTIN_IDS.has(providers[i].id)) providers.splice(i, 1);
  }

  // Re-scan and load
  await loadExternalProviders();

  // Re-register capabilities for new externals
  for (const def of providers) {
    if (!BUILTIN_IDS.has(def.id)) {
      if (def.register) def.register(capabilities.createAPI(def.id));
    }
  }

  const currentExternal = providers
    .filter((p) => !BUILTIN_IDS.has(p.id))
    .map((p) => p.id);

  return {
    added: currentExternal.filter((id) => !previousExternal.includes(id)),
    removed: previousExternal.filter((id) => !currentExternal.includes(id)),
  };
}
