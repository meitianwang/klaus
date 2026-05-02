/**
 * PlatformSettingsRepoPg — PG implementation of the platform_settings KV table.
 *
 * Replaces the SQLite SettingsStore.get/set methods that operated on the legacy
 * `settings` KV table. Per Phase 0 split, only platform-global keys live here;
 * per-user keys go through user_settings (UserSettingsRepoPg).
 *
 * value is JSONB but we accept/return strings to match SQLite.
 */

import { eq, sql, like } from "drizzle-orm";
import type { Db } from "../connection.js";
import { platformSettings } from "../schema.js";

export class PlatformSettingsRepoPg {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | undefined> {
    const r = await this.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .limit(1);
    if (!r[0]) return undefined;
    const v = r[0].value as unknown;
    return typeof v === "string" ? v : JSON.stringify(v);
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(platformSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value },
      });
  }

  /** Bulk-read all settings whose key starts with the given prefix. */
  async getByPrefix(prefix: string): Promise<Map<string, string>> {
    // Escape % and _ so they're matched literally.
    const escaped = prefix.replace(/[%_]/g, (ch) => `\\${ch}`);
    const rows = await this.db
      .select()
      .from(platformSettings)
      .where(sql`${platformSettings.key} LIKE ${escaped + "%"} ESCAPE '\\'`);
    const out = new Map<string, string>();
    for (const r of rows) {
      const v = r.value as unknown;
      out.set(r.key, typeof v === "string" ? v : JSON.stringify(v));
    }
    return out;
  }

  async delete(key: string): Promise<boolean> {
    const r = await this.db
      .delete(platformSettings)
      .where(eq(platformSettings.key, key))
      .returning({ key: platformSettings.key });
    return r.length > 0;
  }
}
