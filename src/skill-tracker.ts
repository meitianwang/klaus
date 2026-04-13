/**
 * Skill Tracker — 记录技能使用事件。
 *
 * 每次 agent 调用 Skill 工具时记录到 per-user JSONL 文件，
 * 供 skill-audit.ts 定期分析。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillUsageEvent {
  skill: string;
  ts: number;
  sessionKey: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USAGE_FILE = "skill-usage.jsonl";

function usagePath(userDir: string): string {
  return join(userDir, USAGE_FILE);
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Append a skill usage event to the user's tracking file.
 * Fire-and-forget — caller should not await.
 */
export async function recordSkillUsage(
  userDir: string,
  skill: string,
  sessionKey: string,
): Promise<void> {
  const fp = usagePath(userDir);
  try {
    await mkdir(dirname(fp), { recursive: true });
    const event: SkillUsageEvent = { skill, ts: Date.now(), sessionKey };
    await appendFile(fp, JSON.stringify(event) + "\n", "utf-8");
  } catch (e) {
    console.error(`[SkillTracker] Failed to record usage:`, (e as Error).message);
  }
}

/**
 * Read all skill usage events for a user.
 */
export async function readSkillUsage(userDir: string): Promise<SkillUsageEvent[]> {
  const fp = usagePath(userDir);
  try {
    const raw = await readFile(fp, "utf-8");
    const events: SkillUsageEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SkillUsageEvent);
      } catch {
        // skip malformed
      }
    }
    return events;
  } catch {
    return [];
  }
}
