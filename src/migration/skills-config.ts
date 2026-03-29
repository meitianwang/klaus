/**
 * One-time migration: config.yaml `skills` section → SettingsStore.
 *
 * After migration, config.yaml `skills` field is ignored.
 * SettingsStore becomes the single source of truth for skill enablement.
 */

import { loadConfig } from "../config.js";
import type { SettingsStore } from "../settings-store.js";

const MARKER = "migration.skills_config_done";

export function migrateSkillsConfigIfNeeded(
  store: SettingsStore,
  encrypt: (plaintext: string) => string,
): void {
  if (store.get(MARKER) === "true") return;

  const cfg = loadConfig();
  const raw = cfg.skills;

  if (raw === "all") {
    // "all" → set a global flag so loadEnabledSkills treats unset skills as enabled
    store.set("skills.default_enabled", "true");
    console.log("[Migration] skills: all → skills.default_enabled=true");
  } else if (Array.isArray(raw)) {
    for (const name of raw) {
      const key = `skill.${String(name)}.enabled`;
      if (!store.get(key)) store.set(key, "true");
    }
    console.log(`[Migration] skills: [${raw.join(", ")}] → individual enabled keys`);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = (raw as Record<string, unknown>).entries as
      | Record<string, { enabled?: boolean; env?: Record<string, string> }>
      | undefined;
    if (entries) {
      for (const [name, skillCfg] of Object.entries(entries)) {
        if (skillCfg.enabled !== undefined && !store.get(`skill.${name}.enabled`)) {
          store.set(`skill.${name}.enabled`, skillCfg.enabled ? "true" : "false");
        }
        // Migrate env vars → only the first non-empty value is stored as the skill's API key.
        // The new model supports one API key per skill (primaryEnv). Extra env vars are lost.
        if (skillCfg.env) {
          const envEntries = Object.entries(skillCfg.env).filter(([, v]) => Boolean(v));
          if (envEntries.length > 1) {
            console.warn(`[Migration] skill "${name}" has ${envEntries.length} env vars but only 1 apiKey slot — extra vars will be lost`);
          }
          const first = envEntries[0];
          if (first && !store.get(`skill.${name}.apiKey`)) {
            store.set(`skill.${name}.apiKey`, encrypt(first[1]));
          }
        }
      }
      console.log(`[Migration] skills.entries → SettingsStore (${Object.keys(entries).length} skills)`);
    }
  }

  store.set(MARKER, "true");
}
