/**
 * Skill status — aggregates all discovered skills with eligibility, missing deps, and install options.
 * Used by the admin API and UI.
 */

import {
  loadEnabledSkills,
  loadAllSkillEntries,
  hasBinary,
  type KlausSkillMetadata,
} from "./index.js";
import { getSkillRegistry } from "./registry.js";
import type { InstallSpec } from "./installer.js";
import type { SettingsStore } from "../settings-store.js";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillStatusEntry {
  readonly name: string;
  readonly description: string;
  readonly source: "bundled" | "user" | "plugin";
  readonly emoji?: string;
  readonly primaryEnv?: string;
  readonly hasApiKey: boolean;
  readonly enabled: boolean;
  readonly eligible: boolean;
  readonly always: boolean;
  readonly missing: {
    readonly bins: string[];
    readonly env: string[];
  };
  readonly install: InstallSpec[];
}

// ---------------------------------------------------------------------------
// Missing deps detection
// ---------------------------------------------------------------------------

function getMissingBins(meta?: KlausSkillMetadata): string[] {
  const missing: string[] = [];
  if (!meta?.requires) return missing;

  if (meta.requires.bins) {
    for (const bin of meta.requires.bins) {
      if (!hasBinary(bin)) missing.push(bin);
    }
  }
  if (meta.requires.anyBins && meta.requires.anyBins.length > 0) {
    const hasAny = meta.requires.anyBins.some((b) => hasBinary(b));
    if (!hasAny) missing.push(...meta.requires.anyBins);
  }

  return missing;
}

function getMissingEnv(meta?: KlausSkillMetadata, storedApiKey?: string): string[] {
  if (!meta?.requires?.env) return [];
  return meta.requires.env.filter((e) => {
    if (process.env[e]) return false;
    // If this env var matches primaryEnv and we have a stored API key, it's satisfied
    if (e === meta.primaryEnv && storedApiKey) return false;
    return true;
  });
}

function extractInstallSpecs(meta?: KlausSkillMetadata): InstallSpec[] {
  if (!meta?.install) return [];
  return meta.install
    .filter((s) => ["brew", "npm", "go", "uv"].includes(s.kind))
    .map((s) => ({
      id: s.id,
      kind: s.kind as InstallSpec["kind"],
      formula: s.formula,
      package: s.package,
      label: s.label,
    }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build a status report for all discovered skills (not just enabled). */
export function buildSkillStatus(): SkillStatusEntry[] {
  const registry = getSkillRegistry();
  const pluginDirs = registry.getPluginDirList();
  const rawLookup = registry.getApiKeyLookup();
  // Cache API key lookups to avoid redundant SQLite reads + decryption
  const keyCache = new Map<string, string | undefined>();
  const apiKeyLookup: typeof rawLookup = rawLookup
    ? (name) => {
        if (!keyCache.has(name)) keyCache.set(name, rawLookup(name));
        return keyCache.get(name);
      }
    : undefined;
  const allEntries = loadAllSkillEntries(pluginDirs);
  const enabledNames = new Set(
    loadEnabledSkills(pluginDirs, allEntries, apiKeyLookup).map((e) => e.name),
  );

  return allEntries.map((entry) => {
    const meta = entry.metadata;
    const storedKey = apiKeyLookup?.(entry.name);
    const missingBins = getMissingBins(meta);
    const missingEnv = getMissingEnv(meta, storedKey);

    return {
      name: entry.name,
      description: entry.description,
      source: entry.source,
      emoji: meta?.emoji,
      primaryEnv: meta?.primaryEnv,
      hasApiKey: Boolean(storedKey),
      enabled: enabledNames.has(entry.name),
      eligible: missingBins.length === 0 && missingEnv.length === 0,
      always: meta?.always ?? false,
      missing: { bins: missingBins, env: missingEnv },
      install: extractInstallSpecs(meta),
    };
  });
}

// ---------------------------------------------------------------------------
// Per-user skill status (user settings page)
// ---------------------------------------------------------------------------

export interface UserSkillStatusEntry {
  readonly name: string;
  readonly description: string;
  readonly source: "bundled" | "user" | "plugin";
  readonly emoji?: string;
  readonly always: boolean;
  readonly userEnabled: boolean;
}

/** Build skill list for a specific user — only admin-enabled skills, with user preferences. */
export function buildUserSkillStatus(userId: string, store: SettingsStore): UserSkillStatusEntry[] {
  const all = buildSkillStatus();
  // Only show skills that admin has enabled (or always-on)
  const available = all.filter((s) => s.enabled || s.always);

  return available.map((s) => {
    const pref = store.get(`user.${userId}.skill.${s.name}`);
    return {
      name: s.name,
      description: s.description,
      source: s.source,
      emoji: s.emoji,
      always: s.always,
      userEnabled: s.always || pref !== "off", // always-on can't be disabled; default = on
    };
  });
}
