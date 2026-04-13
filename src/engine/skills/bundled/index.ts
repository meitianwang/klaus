import { feature } from 'bun:bundle'
import { registerBatchSkill } from './batch.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSkillCreatorSkill } from './skillCreator.js'
import { registerStuckSkill } from './stuck.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'

/**
 * Initialize all bundled skills.
 * Called at startup to register skills that ship with the CLI.
 *
 * To add a new bundled skill:
 * 1. Create a new file in src/skills/bundled/ (e.g., myskill.ts)
 * 2. Export a register function that calls registerBundledSkill()
 * 3. Import and call that function here
 */
export function initBundledSkills(): void {
  // Removed for Klaus: updateConfig (uses settings.json not SettingsStore),
  // keybindings (CLI-only), loremIpsum (testing), claudeApi (feature-gated below)
  registerVerifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerSkillCreatorSkill()
  // dream (KAIROS) and hunter (REVIEW_ARTIFACT) skills removed — source files not present in Klaus
  if (feature('AGENT_TRIGGERS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerLoopSkill } = require('./loop.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    // /loop's isEnabled delegates to isKairosCronEnabled() — same lazy
    // per-invocation pattern as the cron tools. Registered unconditionally;
    // the skill's own isEnabled callback decides visibility.
    registerLoopSkill()
  }
  // runSkillGenerator skill removed — source file not present in Klaus
}
