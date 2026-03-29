/**
 * Skill status — aggregates all discovered skills with eligibility, missing deps, and install options.
 * Used by the admin API, user settings API, and UI.
 */

import {
  loadEnabledSkills,
  hasBinary,
  type KlausSkillMetadata,
} from "./index.js";
import { getSkillRegistry } from "./registry.js";
import { INSTALL_KINDS, type InstallSpec } from "./installer.js";
import type { SettingsStore } from "../settings-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillStatusBase {
  readonly name: string;
  readonly description: string;
  readonly source: "bundled" | "user" | "plugin";
  readonly emoji?: string;
  readonly always: boolean;
  readonly eligible: boolean;
  readonly missing: {
    readonly bins: string[];
    readonly env: string[];
  };
  readonly install: InstallSpec[];
}

interface SkillStatusEntry extends SkillStatusBase {
  readonly primaryEnv?: string;
  readonly hasApiKey: boolean;
  readonly enabled: boolean;
}

interface UserSkillStatusEntry extends SkillStatusBase {
  readonly userEnabled: boolean;
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
    if (e === meta.primaryEnv && storedApiKey) return false;
    return true;
  });
}

function extractInstallSpecs(meta?: KlausSkillMetadata): InstallSpec[] {
  if (!meta?.install) return [];
  return meta.install
    .filter((s) => (INSTALL_KINDS as readonly string[]).includes(s.kind))
    .map((s) => ({
      id: s.id,
      kind: s.kind as InstallSpec["kind"],
      formula: s.formula,
      package: s.package,
      label: s.label,
    }));
}

// ---------------------------------------------------------------------------
// Admin skill status (admin panel)
// ---------------------------------------------------------------------------

/** Build a status report for all discovered skills (not just enabled). */
function buildSkillStatus(): SkillStatusEntry[] {
  const registry = getSkillRegistry();
  const skillSettings = registry.loadSkillSettings();
  const defaultEnabled = registry.getDefaultEnabled();
  const allEntries = registry.getAllEntries();
  const enabledNames = new Set(
    loadEnabledSkills({ preloaded: allEntries, skillSettings, defaultEnabled }).map((e) => e.name),
  );

  return allEntries.map((entry) => {
    const meta = entry.metadata;
    const settings = skillSettings.get(entry.name);
    const missingBins = getMissingBins(meta);
    const missingEnv = getMissingEnv(meta, settings?.apiKey);

    return {
      name: entry.name,
      description: entry.description,
      source: entry.source,
      emoji: meta?.emoji,
      primaryEnv: meta?.primaryEnv,
      hasApiKey: Boolean(settings?.apiKey),
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

/** Build skill list for a specific user — all discovered skills with user preferences. */
export function buildUserSkillStatus(userId: string, store: SettingsStore): UserSkillStatusEntry[] {
  const all = buildSkillStatus();
  const userPrefs = store.getUserSkillPreferences(userId); // 1 bulk SQL query

  return all.map((s) => ({
    name: s.name,
    description: s.description,
    source: s.source,
    emoji: s.emoji,
    always: s.always,
    eligible: s.eligible,
    userEnabled: s.always || userPrefs.get(s.name) !== "off",
    missing: s.missing,
    install: s.install,
  }));
}
