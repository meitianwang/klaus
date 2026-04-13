/**
 * Skill Nudge — 自动技能创建。
 *
 * 对话结束后，如果工具调用次数超过阈值，后台 fork subagent 审查对话，
 * 判断是否有可复用的流程值得固化为 SKILL.md。
 *
 * 使用 runForkedAgent 共享父对话的 prompt cache，subagent 有
 * FileRead/FileWrite/Glob 权限，仅限写入用户的 skills 目录。
 */

import { stat, writeFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { getUserSkillsDir } from "./user-dirs.js";
import {
  getLastCacheSafeParams,
  runForkedAgent,
} from "./engine/utils/forkedAgent.js";
import { createUserMessage } from "./engine/utils/messages.js";
import { FILE_READ_TOOL_NAME } from "./engine/tools/FileReadTool/prompt.js";
import { FILE_WRITE_TOOL_NAME } from "./engine/tools/FileWriteTool/prompt.js";
import { GLOB_TOOL_NAME } from "./engine/tools/GlobTool/prompt.js";
import { GREP_TOOL_NAME } from "./engine/tools/GrepTool/prompt.js";
import { FILE_EDIT_TOOL_NAME } from "./engine/tools/FileEditTool/constants.js";
import type { Tool } from "./engine/Tool.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Minimum tool calls in a session to trigger a nudge. */
export const NUDGE_THRESHOLD = 10;

/** Lock file name inside user dir. */
const LOCK_FILE = ".skill-nudge-lock";

/** Minimum seconds between nudges for the same user. */
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Per-user file lock
// ---------------------------------------------------------------------------

async function tryAcquireLock(userDir: string): Promise<boolean> {
  const lockPath = join(userDir, LOCK_FILE);
  try {
    const s = await stat(lockPath);
    if (Date.now() - s.mtimeMs < COOLDOWN_MS) {
      return false; // Still in cooldown
    }
  } catch {
    // No lock file — proceed
  }
  try {
    await writeFile(lockPath, String(Date.now()), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildNudgePrompt(skillsDir: string): string {
  return `# Skill Review

You are reviewing the conversation above to decide whether a reusable skill should be created.

## Analysis Criteria

1. Was a non-trivial approach used that required trial-and-error, debugging, or multi-step problem solving?
2. Is this workflow likely to recur — would a future conversation benefit from having this approach documented?
3. Is there a clear, repeatable procedure that can be extracted?

If the conversation was straightforward, or the approach is too specific to generalize, respond with "Nothing to save." and stop.

## Instructions

1. First, use Glob to check existing skills in \`${skillsDir}\` to avoid duplicates.
2. If a relevant skill already exists, consider updating it instead of creating a new one.
3. If a new skill should be created, write a SKILL.md file to \`${skillsDir}/<skill-name>/SKILL.md\`.

## SKILL.md Format

\`\`\`markdown
---
name: skill-name-in-kebab-case
description: One-line description of what this skill does
when_to_use: When the user wants to... Examples: 'do X', 'fix Y'
---

# Skill Title

## Steps

### 1. Step Name
What to do. Be specific and actionable.

**Success criteria**: How to know this step is done.
\`\`\`

If nothing is worth saving, just say "Nothing to save." and stop.`;
}

// ---------------------------------------------------------------------------
// Tool permission gate
// ---------------------------------------------------------------------------

function createSkillNudgeCanUseTool(skillsDir: string) {
  return async (tool: Tool, input: Record<string, unknown>) => {
    // Allow read-only tools unconditionally
    if (
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === GREP_TOOL_NAME ||
      tool.name === GLOB_TOOL_NAME
    ) {
      return { behavior: "allow" as const, updatedInput: input };
    }

    // Allow Write/Edit only within the skills directory
    if (
      (tool.name === FILE_WRITE_TOOL_NAME || tool.name === FILE_EDIT_TOOL_NAME) &&
      "file_path" in input
    ) {
      const filePath = normalize(String(input.file_path));
      const boundary = skillsDir.endsWith(sep) ? skillsDir : skillsDir + sep;
      if (filePath.startsWith(boundary)) {
        return { behavior: "allow" as const, updatedInput: input };
      }
      return {
        behavior: "deny" as const,
        message: `Skill nudge can only write to ${skillsDir}`,
        decisionReason: { type: "other" as const, reason: "outside skills dir" },
      };
    }

    // Deny everything else
    return {
      behavior: "deny" as const,
      message: `Tool ${tool.name} is not permitted in skill nudge context`,
      decisionReason: { type: "other" as const, reason: "not allowed" },
    };
  };
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run the skill nudge review for a user's completed session.
 * Fire-and-forget — errors are silently logged.
 */
export async function runSkillNudge(
  userId: string,
  userDir: string,
): Promise<void> {
  // File-based lock with cooldown
  if (!(await tryAcquireLock(userDir))) {
    return;
  }

  const cacheSafeParams = getLastCacheSafeParams();
  if (!cacheSafeParams) {
    console.log("[SkillNudge] No cache-safe params available, skipping");
    return;
  }

  const skillsDir = getUserSkillsDir(userId);

  try {
    const prompt = buildNudgePrompt(skillsDir);
    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: prompt })],
      cacheSafeParams,
      canUseTool: createSkillNudgeCanUseTool(skillsDir),
      querySource: "skill_nudge" as any,
      forkLabel: "skill_nudge",
      skipTranscript: true,
      skipCacheWrite: true,
      maxTurns: 6,
    });

    // Check if the agent wrote any files
    const writtenFiles: string[] = [];
    for (const msg of result.messages) {
      if (msg.type !== "assistant") continue;
      for (const block of (msg as any).message?.content ?? []) {
        if (
          block.type === "tool_use" &&
          (block.name === FILE_WRITE_TOOL_NAME || block.name === FILE_EDIT_TOOL_NAME)
        ) {
          const fp = (block.input as any)?.file_path;
          if (typeof fp === "string") writtenFiles.push(fp);
        }
      }
    }

    if (writtenFiles.length > 0) {
      console.log(`[SkillNudge] Created/updated skills for user ${userId}: ${writtenFiles.join(", ")}`);
    }
  } catch (e) {
    console.error(`[SkillNudge] Error for user ${userId}:`, (e as Error).message);
  }
}
