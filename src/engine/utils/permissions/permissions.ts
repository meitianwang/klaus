/**
 * Permission utilities — simplified from claude-code's permissions.ts.
 * Stripped: React UI, speculative classifier, bun:bundle, analytics, GrowthBook.
 * Klaus auto-approves all tools, so these are minimal implementations.
 */

import type { Tool, ToolPermissionContext } from '../../Tool.js'
import type {
  PermissionBehavior,
  PermissionDecision,
  PermissionResult,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
  ToolPermissionRulesBySource,
} from '../../types/permissions.js'

// ============================================================================
// Rule value parsing (inlined from permissionRuleParser.ts)
// ============================================================================

/**
 * Parse a permission rule string like "Bash(prefix:npm)" into a PermissionRuleValue.
 */
export function permissionRuleValueFromString(
  ruleString: string,
): PermissionRuleValue {
  const match = ruleString.match(/^([^(]+?)(?:\((.+)\))?$/)
  if (!match) {
    return { toolName: ruleString }
  }
  const [, toolName, ruleContent] = match
  return ruleContent !== undefined
    ? { toolName: toolName!, ruleContent }
    : { toolName: toolName! }
}

/**
 * Convert a PermissionRuleValue back to its string representation.
 */
export function permissionRuleValueToString(
  ruleValue: PermissionRuleValue,
): string {
  if (ruleValue.ruleContent !== undefined) {
    return `${ruleValue.toolName}(${ruleValue.ruleContent})`
  }
  return ruleValue.toolName
}

// ============================================================================
// Rule sources
// ============================================================================

const PERMISSION_RULE_SOURCES: readonly PermissionRuleSource[] = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
  'cliArg',
  'command',
  'session',
]

// ============================================================================
// Rule accessors
// ============================================================================

export function getAllowRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAllowRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'allow' as const,
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

export function getDenyRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysDenyRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'deny' as const,
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

export function getAskRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAskRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'ask' as const,
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

// ============================================================================
// Core permission functions
// ============================================================================

/**
 * Check if the entire tool is listed in the always-allow rules.
 */
export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
): PermissionRule | null {
  for (const rule of getAllowRules(context)) {
    if (
      rule.ruleValue.toolName === tool.name &&
      rule.ruleValue.ruleContent === undefined
    ) {
      return rule
    }
  }
  return null
}

/**
 * Map of rule contents to the associated rule for a given tool name.
 * e.g. "prefix:*" from "Bash(prefix:*)" for BashTool
 */
export function getRuleByContentsForToolName(
  context: ToolPermissionContext,
  toolName: string,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  const ruleByContents = new Map<string, PermissionRule>()
  let rules: PermissionRule[] = []
  switch (behavior) {
    case 'allow':
      rules = getAllowRules(context)
      break
    case 'deny':
      rules = getDenyRules(context)
      break
    case 'ask':
      rules = getAskRules(context)
      break
  }
  for (const rule of rules) {
    if (
      rule.ruleValue.toolName === toolName &&
      rule.ruleValue.ruleContent !== undefined &&
      rule.ruleBehavior === behavior
    ) {
      ruleByContents.set(rule.ruleValue.ruleContent, rule)
    }
  }
  return ruleByContents
}

/**
 * Map of rule contents to the associated rule for a given tool.
 */
export function getRuleByContentsForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  return getRuleByContentsForToolName(context, tool.name, behavior)
}

/**
 * Filter agents to exclude those that are denied via Agent(agentType) syntax.
 */
export function filterDeniedAgents<T extends { agentType: string }>(
  agents: T[],
  context: ToolPermissionContext,
  agentToolName: string,
): T[] {
  const deniedAgentTypes = new Set<string>()
  for (const rule of getDenyRules(context)) {
    if (
      rule.ruleValue.toolName === agentToolName &&
      rule.ruleValue.ruleContent !== undefined
    ) {
      deniedAgentTypes.add(rule.ruleValue.ruleContent)
    }
  }
  return agents.filter(agent => !deniedAgentTypes.has(agent.agentType))
}

/**
 * Klaus auto-approves all tools — this is the simplified permission check.
 * Always returns an "allow" decision.
 */
export async function checkToolPermission(
  _tool: Pick<Tool, 'name'>,
  _input: Record<string, unknown>,
  _context: ToolPermissionContext,
): Promise<PermissionDecision> {
  return { behavior: 'allow' }
}
