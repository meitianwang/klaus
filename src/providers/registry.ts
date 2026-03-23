import type { ProviderDefinition } from "./types.js";
import { registerProvider } from "klaus-agent";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_DIR } from "../config.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiProvider } from "./openai.js";
import { openaiResponsesProvider } from "./openai-responses.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { googleProvider } from "./google.js";
import { moonshotProvider } from "./moonshot-def.js";
import { moonshotCnProvider } from "./moonshot-cn.js";

const providers: ProviderDefinition[] = [
  anthropicProvider,
  openaiProvider,
  openaiResponsesProvider,
  openaiCodexProvider,
  googleProvider,
  moonshotProvider,
  moonshotCnProvider,
];

const byId = new Map<string, ProviderDefinition>(
  providers.map((p) => [p.id, p]),
);

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
      const mod = await import(pathToFileURL(join(dir, file)).href);
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

export function registerAllFactories(): void {
  for (const def of providers) {
    if (def.factory) {
      registerProvider(def.id, def.factory);
    }
  }
}
