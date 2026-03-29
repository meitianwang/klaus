/**
 * SkillRegistry — singleton that manages skill discovery, caching, and hot reload.
 *
 * Wraps the skill loader with:
 * - Version-counter cache (invalidated on filesystem changes)
 * - Chokidar file watcher for hot reload
 * - Plugin directory registration for channel plugins
 * - Bulk skill settings loading via SettingsStore
 */

import chokidar, { type FSWatcher } from "chokidar";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { SettingsStore } from "../settings-store.js";
import {
  loadAllSkillEntries,
  loadResolvedSkills,
  clearBinCache,
  resolveBundledSkillsDir,
  USER_SKILLS_DIR,
  type SkillEntry,
  type ResolvedSkill,
  type SkillSettingEntry,
} from "./index.js";

const WATCH_DEBOUNCE_MS = 500;
const IGNORED_DIRS = /(?:^|[\\/])(?:\.git|node_modules|dist|\.venv|__pycache__)(?:[\\/]|$)/;

class SkillRegistry {
  private version = 0;
  private cache: ResolvedSkill[] | null = null;
  private allEntriesCache: SkillEntry[] | null = null;
  private skillSettingsCache: ReadonlyMap<string, SkillSettingEntry> | null = null;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pluginDirs = new Map<string, string>();
  private store: SettingsStore | undefined;
  private decryptFn: ((encrypted: string) => string) | undefined;

  /** Current version — bumped on every invalidation. */
  getVersion(): number {
    return this.version;
  }

  /**
   * Initialize with SettingsStore and decryption function.
   * Called once at startup. Replaces setApiKeyLookup + setEnabledLookup.
   */
  init(store: SettingsStore, decrypt: (encrypted: string) => string): void {
    this.store = store;
    this.decryptFn = decrypt;
    this.invalidate();
  }

  /**
   * Cached bulk-load of all skill settings from SettingsStore, decrypting API keys.
   * Single SQL query → Map<skillName, SkillSettingEntry>. Invalidated with cache.
   */
  loadSkillSettings(): ReadonlyMap<string, SkillSettingEntry> {
    if (this.skillSettingsCache) return this.skillSettingsCache;
    if (!this.store) return new Map();
    const raw = this.store.getSkillSettings();
    const result = new Map<string, SkillSettingEntry>();
    for (const [name, { enabled, encryptedApiKey }] of raw) {
      const apiKey = encryptedApiKey && this.decryptFn
        ? this.decryptFn(encryptedApiKey) || undefined
        : undefined;
      result.set(name, { enabled, apiKey });
    }
    this.skillSettingsCache = result;
    return result;
  }

  /** Cached filesystem scan of all discovered skill entries. Invalidated with cache. */
  getAllEntries(): SkillEntry[] {
    if (!this.allEntriesCache) {
      this.allEntriesCache = loadAllSkillEntries(this.getPluginDirList());
    }
    return this.allEntriesCache;
  }

  /** Whether skills without explicit settings should be treated as enabled. */
  getDefaultEnabled(): boolean {
    return this.store?.getBool("skills.default_enabled", false) ?? false;
  }

  /** Get cached enabled skills, rebuilding if dirty. */
  getSkills(): ResolvedSkill[] {
    if (!this.cache) {
      this.cache = loadResolvedSkills({
        preloaded: this.getAllEntries(),
        skillSettings: this.loadSkillSettings(),
        defaultEnabled: this.getDefaultEnabled(),
      });
    }
    return this.cache;
  }

  /** Invalidate all caches and bump version. Next access rebuilds. */
  invalidate(): void {
    this.cache = null;
    this.allEntriesCache = null;
    this.skillSettingsCache = null;
    this.version++;
  }

  /** Clear the binary detection cache (call after installing deps). */
  resetBinCache(): void {
    clearBinCache();
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // Plugin directories
  // -------------------------------------------------------------------------

  registerPluginDir(channelId: string, dir: string): void {
    if (!existsSync(dir)) return;
    this.pluginDirs.set(channelId, dir);
    this.watcher?.add(join(dir, "**", "SKILL.md"));
    this.invalidate();
  }

  unregisterPluginDir(channelId: string): void {
    const dir = this.pluginDirs.get(channelId);
    if (!dir) return;
    this.pluginDirs.delete(channelId);
    this.watcher?.unwatch(join(dir, "**", "SKILL.md"));
    this.invalidate();
  }

  getPluginDirList(): string[] {
    return [...this.pluginDirs.values()];
  }

  // -------------------------------------------------------------------------
  // File watcher
  // -------------------------------------------------------------------------

  startWatching(): void {
    if (this.watcher) return;

    const watchPaths = [
      join(resolveBundledSkillsDir(), "**", "SKILL.md"),
      join(USER_SKILLS_DIR, "**", "SKILL.md"),
      ...this.getPluginDirList().map((d) => join(d, "**", "SKILL.md")),
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: IGNORED_DIRS,
      awaitWriteFinish: {
        stabilityThreshold: WATCH_DEBOUNCE_MS,
        pollInterval: 100,
      },
    });

    const onChange = () => this.scheduleInvalidate();
    this.watcher.on("add", onChange);
    this.watcher.on("change", onChange);
    this.watcher.on("unlink", onChange);
  }

  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
  }

  private scheduleInvalidate(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.invalidate();
      console.log("[Skills] File change detected, cache invalidated");
    }, WATCH_DEBOUNCE_MS);
    this.debounceTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!instance) {
    instance = new SkillRegistry();
  }
  return instance;
}
