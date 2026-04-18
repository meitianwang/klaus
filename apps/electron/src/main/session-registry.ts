import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = join(homedir(), '.klaus')
const REGISTRY_PATH = join(CONFIG_DIR, 'session-registry.json')

/**
 * Maps **channel-key** (business id — e.g. `app:local`, `wechat:<senderId>`)
 * to the **engine session uuid** that CC's sessionStorage persists transcripts
 * under. Each channel-key holds ONE "current" uuid at a time; users may
 * explicitly rotate it via /new to start a fresh conversation from that entry
 * point while prior uuids remain as read-only history in the sidebar.
 *
 * Why a registry:
 *   CC's sessionStorage hardcodes `validateUuid` on session file names
 *   (sessionStorage.ts:4288) — non-uuid ids like `wechat:abc` simply aren't
 *   scanned. Klaus has to maintain a mapping so channel-originated messages
 *   land in a uuid-named JSONL the engine will respect.
 *
 * Stored as a plain JSON file (`~/.klaus/session-registry.json`). Flat dict,
 * no schema versioning — rewrite-in-place on every mutation.
 */
export class SessionKeyRegistry {
  private map = new Map<string, string>()
  private reverse = new Map<string, string>()

  constructor() {
    mkdirSync(CONFIG_DIR, { recursive: true })
    this.load()
  }

  private load(): void {
    if (!existsSync(REGISTRY_PATH)) return
    try {
      const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as Record<string, string>
      for (const [key, uuid] of Object.entries(raw)) {
        this.map.set(key, uuid)
        this.reverse.set(uuid, key)
      }
    } catch (err) {
      console.warn('[SessionRegistry] Failed to load; starting empty:', err)
    }
  }

  private persist(): void {
    const obj: Record<string, string> = {}
    for (const [key, uuid] of this.map) obj[key] = uuid
    writeFileSync(REGISTRY_PATH, JSON.stringify(obj, null, 2))
  }

  /**
   * Resolve the current uuid for a channel-key. Creates a new uuid (and
   * persists it) if the key has never been seen before. This is the ONLY
   * path used by engine.chat() — a channelKey always gets a valid uuid.
   */
  getOrCreateUuid(channelKey: string): string {
    const existing = this.map.get(channelKey)
    if (existing) return existing
    const uuid = randomUUID()
    this.map.set(channelKey, uuid)
    this.reverse.set(uuid, channelKey)
    this.persist()
    return uuid
  }

  /**
   * Reverse lookup — given a uuid, what channel-key owns it (for sidebar
   * badges: "this uuid came from wechat:senderId"). Returns null for uuids
   * that were rotated away (historical) — they're still on disk but no
   * longer the current uuid for any channelKey.
   */
  sessionKeyOf(uuid: string): string | null {
    return this.reverse.get(uuid) ?? null
  }

  /**
   * User explicitly started a fresh conversation from this entry point.
   * The old uuid stays on disk (read-only history), the key now points to
   * a new uuid. Returns the new uuid so the caller can switchSession().
   */
  rotate(channelKey: string): string {
    const oldUuid = this.map.get(channelKey)
    if (oldUuid) this.reverse.delete(oldUuid)
    const fresh = randomUUID()
    this.map.set(channelKey, fresh)
    this.reverse.set(fresh, channelKey)
    this.persist()
    return fresh
  }

  /**
   * Delete a uuid's entry entirely — called when the user removes a session
   * from the sidebar. Finds and removes any channelKey→uuid pairing that
   * currently points at this uuid (historical pairings untouched).
   */
  forgetUuid(uuid: string): void {
    const channelKey = this.reverse.get(uuid)
    if (channelKey) {
      this.map.delete(channelKey)
      this.reverse.delete(uuid)
      this.persist()
    }
  }

  /** All current pairings — used when reconciling sidebar listings. */
  entries(): Array<{ channelKey: string; uuid: string }> {
    return [...this.map.entries()].map(([channelKey, uuid]) => ({ channelKey, uuid }))
  }
}
