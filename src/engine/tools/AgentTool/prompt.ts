/**
 * AgentTool prompt — simplified from claude-code's AgentTool/prompt.ts.
 * Stripped: fork subagent, coordinator mode, GrowthBook, embedded search tools,
 *           teammate, swarm, subscription type, SendMessage, remote isolation.
 * Preserved: core prompt with agent listing, examples, usage notes.
 */

import type { AgentDefinition } from '../../Tool.js'
import { AGENT_TOOL_NAME } from './constants.js'

function getToolsDescription(agent: AgentDefinition): string {
  const tools = (agent as { tools?: string[] }).tools
  const disallowedTools = (agent as { disallowedTools?: string[] })
    .disallowedTools
  const hasAllowlist = tools && tools.length > 0
  const hasDenylist = disallowedTools && disallowedTools.length > 0

  if (hasAllowlist && hasDenylist) {
    const denySet = new Set(disallowedTools)
    const effectiveTools = tools.filter((t: string) => !denySet.has(t))
    if (effectiveTools.length === 0) return 'None'
    return effectiveTools.join(', ')
  } else if (hasAllowlist) {
    return tools.join(', ')
  } else if (hasDenylist) {
    return `All tools except ${disallowedTools.join(', ')}`
  }
  return 'All tools'
}

export function formatAgentLine(agent: AgentDefinition): string {
  const toolsDescription = getToolsDescription(agent)
  const whenToUse =
    (agent as { whenToUse?: string }).whenToUse ?? agent.description ?? ''
  return `- ${agent.agentType}: ${whenToUse} (Tools: ${toolsDescription})`
}

export async function getPrompt(
  agentDefinitions: AgentDefinition[],
  allowedAgentTypes?: string[],
): Promise<string> {
  const effectiveAgents = allowedAgentTypes
    ? agentDefinitions.filter((a) => allowedAgentTypes.includes(a.agentType))
    : agentDefinitions

  const agentListSection =
    effectiveAgents.length > 0
      ? `Available agent types and the tools they have access to:\n${effectiveAgents.map((agent) => formatAgentLine(agent)).join('\n')}`
      : 'Available agent types are listed in <system-reminder> messages in the conversation.'

  return `Launch a new agent to handle complex, multi-step tasks autonomously.

The ${AGENT_TOOL_NAME} tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

${agentListSection}

When using the ${AGENT_TOOL_NAME} tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.

When NOT to use the ${AGENT_TOOL_NAME} tool:
- If you want to read a specific file path, use the Read tool or the Glob tool instead
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question.

Terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it."

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- Each Agent invocation starts fresh — provide a complete task description.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple ${AGENT_TOOL_NAME} tool use content blocks.

Example usage:

<example>
user: "Please write a function that checks if a number is prime"
assistant: I'm going to use the Write tool to write the code, then use the ${AGENT_TOOL_NAME} tool to launch the test-runner agent.
</example>`
}
