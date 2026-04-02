/**
 * SkillTool — simplified from claude-code's SkillTool/SkillTool.ts.
 * Stripped: React/Ink rendering, commands system, MCP skills, remote skills,
 *           forked execution, plugin identifiers, analytics, GrowthBook,
 *           permission rules, safe properties, processPromptSlashCommand.
 * Preserved: core skill lookup and execution, input/output schema, prompt.
 *
 * In Klaus, skills are simpler: the SkillTool receives a skill name + args,
 * looks up the skill definition, and returns instructions for the model to follow.
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolResult,
  type ToolUseContext,
  type ValidationResult,
} from '../../Tool.js'
import type { SkillToolProgress } from '../../types/tools.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createUserMessage } from '../../utils/messages.js'
import { SKILL_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe(
        'The skill name. E.g., "commit", "review-pr", or "pdf"',
      ),
    args: z
      .string()
      .optional()
      .describe('Optional arguments for the skill'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the skill is valid'),
    commandName: z
      .string()
      .describe('The name of the skill'),
    status: z
      .enum(['inline', 'not_found'])
      .describe('Execution status'),
    result: z
      .string()
      .optional()
      .describe('Result or error message'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/**
 * A simple skill definition for Klaus.
 * Skills are discovered from the AppState or a skill registry.
 */
export interface SkillDefinition {
  name: string
  description: string
  /** The skill content/instructions to inject into conversation */
  content: string
  /** Optional list of tools this skill is allowed to use */
  allowedTools?: string[]
}

/**
 * Get skills from the app state or a skill registry.
 * Override this in Klaus to provide actual skill discovery.
 */
function getSkillsFromContext(
  context: ToolUseContext,
): SkillDefinition[] {
  const appState = context.getAppState()
  // Skills can be stored in app state under a 'skills' key
  const skills = (appState as { skills?: SkillDefinition[] }).skills
  return skills ?? []
}

function findSkill(
  name: string,
  skills: SkillDefinition[],
): SkillDefinition | undefined {
  const normalized = name.startsWith('/') ? name.substring(1) : name
  return skills.find(
    (s) =>
      s.name === normalized ||
      s.name === name ||
      s.name.toLowerCase() === normalized.toLowerCase(),
  )
}

export const SkillTool = buildTool({
  name: SKILL_TOOL_NAME,
  searchHint: 'invoke a slash-command skill',
  maxResultSizeChars: 100_000,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  description: async ({ skill }: { skill: string }) =>
    `Execute skill: ${skill}`,

  prompt: async () => getPrompt(),

  toAutoClassifierInput: ({ skill }: { skill: string }) =>
    skill ?? '',

  userFacingName() {
    return 'Skill'
  },

  getToolUseSummary(input?: Partial<{ skill: string }>) {
    return input?.skill ?? null
  },

  getActivityDescription(input?: Partial<{ skill: string }>) {
    return input?.skill
      ? `Running skill: ${input.skill}`
      : 'Running skill'
  },

  isConcurrencySafe() {
    return false
  },

  isReadOnly() {
    return false
  },

  async validateInput(
    { skill }: { skill: string; args?: string },
    _context: ToolUseContext,
  ): Promise<ValidationResult> {
    const trimmed = skill.trim()
    if (!trimmed) {
      return {
        result: false,
        message: `Invalid skill format: ${skill}`,
        errorCode: 1,
      }
    }
    return { result: true }
  },

  mapToolResultToToolResultBlockParam(
    data: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    const parts: string[] = []
    if (data.success) {
      parts.push(`<skill>${data.commandName}</skill>`)
      if (data.result) {
        parts.push(data.result)
      }
    } else {
      parts.push(
        `<error>Skill '${data.commandName}' ${data.result ?? 'not found'}</error>`,
      )
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: parts.join('\n'),
    }
  },

  async call(
    { skill, args },
    context,
    _canUseTool,
    _parentMessage,
    _onProgress?,
  ): Promise<ToolResult<Output>> {
    const trimmed = skill.trim()
    const commandName = trimmed.startsWith('/')
      ? trimmed.substring(1)
      : trimmed

    // Look up the skill
    const skills = getSkillsFromContext(context)
    const found = findSkill(commandName, skills)

    if (!found) {
      return {
        data: {
          success: false,
          commandName,
          status: 'not_found',
          result: `Unknown skill: ${commandName}. Available skills: ${skills.map((s) => s.name).join(', ') || '(none)'}`,
        },
      }
    }

    // Build the skill content with args
    let skillContent = found.content
    if (args) {
      skillContent = skillContent.replace(/\$ARGUMENTS/g, args)
    }

    // Return the skill content as new messages to inject
    return {
      data: {
        success: true,
        commandName,
        status: 'inline',
        result: skillContent,
      },
      newMessages: [
        createUserMessage({
          content: `<command-name>${commandName}</command-name>\n\n${skillContent}`,
        }),
      ],
    }
  },
} satisfies ToolDef<InputSchema, Output, SkillToolProgress>)
