/**
 * Skill Audit — 定期审计技能效果。
 *
 * 每 7 天运行一次，分析技能使用数据：
 * - 30 天未使用的技能 → 移入 .archive/
 * - 高频技能 → 写入用户 memory 让 agent 优先推荐
 */

import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getUserSkillsDir, getUserMemoryDir } from "./user-dirs.js";
import { readSkillUsage } from "./skill-tracker.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Minimum days between audits for the same user. */
const AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Skills unused for this long get archived. */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/** Lock file tracks last audit time. */
const LOCK_FILE = ".skill-audit-lock";

/** Per-user in-flight guard. */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Time gate
// ---------------------------------------------------------------------------

async function shouldAudit(userDir: string): Promise<boolean> {
  const lockPath = join(userDir, LOCK_FILE);
  try {
    const s = await stat(lockPath);
    return Date.now() - s.mtimeMs >= AUDIT_INTERVAL_MS;
  } catch {
    return true; // No lock file → never audited
  }
}

async function markAudited(userDir: string): Promise<void> {
  await writeFile(join(userDir, LOCK_FILE), String(Date.now()), "utf-8");
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run skill audit for a user. Fire-and-forget.
 */
export async function maybeRunSkillAudit(
  userId: string,
  userDir: string,
): Promise<void> {
  if (inFlight.has(userId)) return;

  if (!(await shouldAudit(userDir))) return;

  inFlight.add(userId);
  try {
    const skillsDir = getUserSkillsDir(userId);
    const archiveDir = join(skillsDir, ".archive");

    // List all skill directories
    let skillDirs: string[];
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      skillDirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return; // No skills directory
    }

    if (skillDirs.length === 0) return;

    // Read usage data
    const events = await readSkillUsage(userDir);
    const now = Date.now();

    // Build usage map: skill → last used timestamp
    const lastUsed = new Map<string, number>();
    const usageCount = new Map<string, number>();
    for (const event of events) {
      const prev = lastUsed.get(event.skill) ?? 0;
      if (event.ts > prev) lastUsed.set(event.skill, event.ts);
      usageCount.set(event.skill, (usageCount.get(event.skill) ?? 0) + 1);
    }

    // Archive stale skills (skip recently created ones that haven't had a chance to be used)
    const archived: string[] = [];
    for (const name of skillDirs) {
      const last = lastUsed.get(name);
      // If never used, check creation time — don't archive skills younger than the stale threshold
      if (last === undefined) {
        try {
          const s = await stat(join(skillsDir, name, "SKILL.md"));
          if (now - s.mtimeMs < STALE_THRESHOLD_MS) continue;
        } catch {
          // No SKILL.md — skip this entry
          continue;
        }
      } else if (now - last <= STALE_THRESHOLD_MS) {
        continue;
      }
      try {
        await mkdir(archiveDir, { recursive: true });
        await rename(join(skillsDir, name), join(archiveDir, name));
        archived.push(name);
        console.log(`[SkillAudit] Archived stale skill "${name}" for user ${userId}`);
      } catch (e) {
        console.error(`[SkillAudit] Failed to archive "${name}":`, (e as Error).message);
      }
    }

    // Identify top skills (used >= 5 times)
    const topSkills: string[] = [];
    for (const [name, count] of usageCount) {
      if (count >= 5 && !archived.includes(name)) {
        topSkills.push(name);
      }
    }

    // Write high-frequency skills to memory if any
    if (topSkills.length > 0) {
      const memoryDir = getUserMemoryDir(userId);
      const memoryFile = join(memoryDir, "frequently_used_skills.md");
      const content = [
        "---",
        "name: frequently-used-skills",
        "description: Skills this user relies on most — prioritize suggesting these",
        "type: feedback",
        "---",
        "",
        `High-frequency skills (as of ${new Date().toISOString().slice(0, 10)}):`,
        "",
        ...topSkills.map((s) => {
          const count = usageCount.get(s) ?? 0;
          return `- **${s}** (used ${count} times)`;
        }),
      ].join("\n");
      try {
        await mkdir(memoryDir, { recursive: true });
        await writeFile(memoryFile, content, "utf-8");
      } catch (e) {
        console.error(`[SkillAudit] Failed to write memory:`, (e as Error).message);
      }
    }

    await markAudited(userDir);
    console.log(
      `[SkillAudit] Completed for user ${userId}: ${archived.length} archived, ${topSkills.length} top skills`,
    );
  } catch (e) {
    console.error(`[SkillAudit] Error for user ${userId}:`, (e as Error).message);
  } finally {
    inFlight.delete(userId);
  }
}
