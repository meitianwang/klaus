// @ts-nocheck
/**
 * commands.ts — Klaus version.
 * Stripped CLI command imports (they reference React/Ink UI).
 * Kept: skill loading, getCommands, getSkillToolCommands, findCommand.
 */
import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import { logError } from './utils/log.js'
import { toError } from './utils/errors.js'
import { logForDebugging } from './utils/debug.js'
import {
  getSkillDirCommands,
  clearSkillCaches,
  getDynamicSkills,
} from './skills/loadSkillsDir.js'
import { getBundledSkills } from './skills/bundledSkills.js'
import { getBuiltinPluginSkillCommands } from './plugins/builtinPlugins.js'
import {
  getPluginCommands,
  clearPluginCommandCache,
  getPluginSkills,
  clearPluginSkillsCache,
} from './utils/plugins/loadPluginCommands.js'
import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from './types/command.js'
import { getSettingSourceName } from './utils/settings/constants.js'

// Re-export types
export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'

// No CLI commands in Klaus — empty arrays
export const INTERNAL_ONLY_COMMANDS: Command[] = []
export const REMOTE_SAFE_COMMANDS: Set<Command> = new Set()
export const BRIDGE_SAFE_COMMANDS: Set<Command> = new Set()

export const builtInCommandNames = memoize(
  (): Set<string> => new Set(),
)

export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true
  for (const a of cmd.availability) {
    switch (a.type) {
      case 'binary': {
        // Skip binary checks in Klaus server mode
        break
      }
      case 'env': {
        if (!process.env[a.name]) return false
        break
      }
    }
  }
  return true
}

// Workflow commands (feature-gated)
const getWorkflowCommands = feature('WORKFLOW_SCRIPTS')
  ? (require('./utils/processUserInput/processSlashCommand.js') as any)?.getWorkflowCommands
  : null

const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/localSearch.js') as any)?.clearSkillIndexCache
  : null

/**
 * Load skills from all sources. Memoized by cwd.
 */
async function getSkills(cwd: string): Promise<{
  skillDirCommands: Command[]
  pluginSkills: Command[]
  bundledSkills: Command[]
  builtinPluginSkills: Command[]
}> {
  const [skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills] =
    await Promise.all([
      getSkillDirCommands(cwd),
      getPluginSkills(),
      Promise.resolve(getBundledSkills()),
      getBuiltinPluginSkillCommands(),
    ])
  return { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills }
}

/**
 * Loads all command sources (skills, plugins, workflows). Memoized by cwd.
 */
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),
    getPluginCommands(),
    getWorkflowCommands ? getWorkflowCommands(cwd) : Promise.resolve([]),
  ])

  return [
    ...bundledSkills,
    ...builtinPluginSkills,
    ...skillDirCommands,
    ...workflowCommands,
    ...pluginCommands,
    ...pluginSkills,
    // No CLI COMMANDS() in Klaus
  ]
})

export async function getCommands(cwd: string): Promise<Command[]> {
  const allCommands = await loadAllCommands(cwd)
  const dynamicSkills = getDynamicSkills()

  const baseCommands = allCommands.filter(
    _ => meetsAvailabilityRequirement(_) && isCommandEnabled(_),
  )

  if (dynamicSkills.length === 0) {
    return baseCommands
  }

  const baseCommandNames = new Set(baseCommands.map(c => c.name))
  const uniqueDynamicSkills = dynamicSkills.filter(
    s =>
      !baseCommandNames.has(s.name) &&
      meetsAvailabilityRequirement(s) &&
      isCommandEnabled(s),
  )

  return [...baseCommands, ...uniqueDynamicSkills]
}

export function clearCommandMemoizationCaches(): void {
  loadAllCommands.cache?.clear?.()
  getSkillToolCommands.cache?.clear?.()
  getSlashCommandToolSkills.cache?.clear?.()
  clearSkillIndexCache?.()
}

export function clearCommandsCache(): void {
  clearCommandMemoizationCaches()
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}

export function getMcpSkillCommands(
  mcpCommands: readonly Command[],
): readonly Command[] {
  if (feature('MCP_SKILLS')) {
    return mcpCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        cmd.loadedFrom === 'mcp' &&
        !cmd.disableModelInvocation,
    )
  }
  return []
}

export const getSkillToolCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const allCommands = await getCommands(cwd)
    return allCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        !cmd.disableModelInvocation &&
        cmd.source !== 'builtin' &&
        (cmd.loadedFrom === 'bundled' ||
          cmd.loadedFrom === 'skills' ||
          cmd.loadedFrom === 'commands_DEPRECATED' ||
          cmd.hasUserSpecifiedDescription ||
          cmd.whenToUse),
    )
  },
)

export const getSlashCommandToolSkills = memoize(
  async (cwd: string): Promise<Command[]> => {
    try {
      const allCommands = await getCommands(cwd)
      return allCommands.filter(
        cmd =>
          cmd.type === 'prompt' &&
          cmd.source !== 'builtin' &&
          (cmd.hasUserSpecifiedDescription || cmd.whenToUse) &&
          (cmd.loadedFrom === 'skills' ||
            cmd.loadedFrom === 'plugin' ||
            cmd.loadedFrom === 'bundled' ||
            cmd.disableModelInvocation),
      )
    } catch (error) {
      logError(toError(error))
      logForDebugging('Returning empty skills array due to load failure')
      return []
    }
  },
)

export function isBridgeSafeCommand(cmd: Command): boolean {
  if (cmd.type === 'local-jsx') return false
  if (cmd.type === 'prompt') return true
  return false
}

export function filterCommandsForRemoteMode(commands: Command[]): Command[] {
  return commands
}

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands?: Command[]): Command {
  const cmds = commands ?? []
  const command = findCommand(commandName, cmds)
  if (!command) {
    throw ReferenceError(`Command ${commandName} not found.`)
  }
  return command
}

export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') {
    return cmd.description
  }
  if (cmd.kind === 'workflow') {
    return `${cmd.description} (workflow)`
  }
  if (cmd.source === 'plugin') {
    const pluginName = (cmd as any).pluginInfo?.pluginManifest?.name
    if (pluginName) return `(${pluginName}) ${cmd.description}`
    return `${cmd.description} (plugin)`
  }
  if (cmd.source === 'builtin' || cmd.source === 'mcp') {
    return cmd.description
  }
  if (cmd.source === 'bundled') {
    return `${cmd.description} (bundled)`
  }
  return `${cmd.description} (${getSettingSourceName(cmd.source)})`
}
