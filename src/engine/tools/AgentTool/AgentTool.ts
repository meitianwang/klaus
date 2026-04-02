/**
 * AgentTool — simplified from claude-code's AgentTool/AgentTool.tsx.
 * Stripped: React/Ink rendering, worktree, remote agent, swarm, color manager,
 *           agent memory, resume, coordinator mode, fork subagent, teammate,
 *           auto-backgrounding, progress tracking, summarization, GrowthBook,
 *           analytics, agent context, proactive module.
 * Preserved: core synchronous subagent execution via query(), input schema,
 *            prompt, description.
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolUseContext,
  type CanUseToolFn,
  type ToolResult,
} from '../../Tool.js'
import type { AgentToolProgress } from '../../types/tools.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { errorMessage } from '../../utils/errors.js'
import { createUserMessage } from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.object({
    description: z
      .string()
      .describe('A short (3-5 word) description of the task'),
    prompt: z.string().describe('The task for the agent to perform'),
    subagent_type: z
      .string()
      .optional()
      .describe(
        'The type of specialized agent to use for this task',
      ),
    model: z
      .enum(['sonnet', 'opus', 'haiku'])
      .optional()
      .describe(
        "Optional model override for this agent.",
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type AgentToolInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('completed'),
    result: z.string().describe('The result from the agent'),
    prompt: z.string().describe('The original prompt'),
    totalToolUseCount: z.number().optional(),
    totalDurationMs: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

/**
 * Extract text content from message content blocks.
 */
function extractTextFromContent(
  content: AssistantMessage['message']['content'],
): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

export const AgentTool = buildTool({
  name: AGENT_TOOL_NAME,
  searchHint: 'delegate work to a subagent',
  aliases: [LEGACY_AGENT_TOOL_NAME],
  maxResultSizeChars: 100_000,

  async description() {
    return 'Launch a new agent'
  },

  async prompt({ agents, allowedAgentTypes }) {
    return getPrompt(agents, allowedAgentTypes)
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  userFacingName() {
    return 'Agent'
  },

  getToolUseSummary(input?: Partial<AgentToolInput>) {
    return input?.description ?? null
  },

  getActivityDescription(input?: Partial<AgentToolInput>) {
    return input?.description
      ? `Running agent: ${input.description}`
      : 'Running agent'
  },

  toAutoClassifierInput(input: AgentToolInput) {
    return input.prompt
  },

  isConcurrencySafe() {
    return false
  },

  isReadOnly() {
    return false
  },

  mapToolResultToToolResultBlockParam(
    data: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    const parts: string[] = []
    parts.push(`<status>${data.status}</status>`)
    if (data.result) {
      parts.push(`<result>\n${data.result}\n</result>`)
    }
    if (data.totalToolUseCount !== undefined) {
      parts.push(
        `<total_tool_uses>${data.totalToolUseCount}</total_tool_uses>`,
      )
    }
    if (data.totalDurationMs !== undefined) {
      parts.push(
        `<duration_ms>${data.totalDurationMs}</duration_ms>`,
      )
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: parts.join('\n\n'),
    }
  },

  async call(
    { prompt, subagent_type, description, model }: AgentToolInput,
    toolUseContext: ToolUseContext,
    canUseTool: CanUseToolFn,
    assistantMessage: AssistantMessage,
    onProgress?,
  ): Promise<ToolResult<Output>> {
    const startTime = Date.now()

    // Look up the agent definition
    const allAgents =
      toolUseContext.options.agentDefinitions.agents
    const effectiveType = subagent_type ?? 'general'
    const selectedAgent = allAgents.find(
      (a) => a.agentType === effectiveType,
    )

    if (!selectedAgent && subagent_type) {
      throw new Error(
        `Agent type '${subagent_type}' not found. Available agents: ${allAgents.map((a) => a.agentType).join(', ')}`,
      )
    }

    // Lazy import to avoid circular dependency
    const { query } = await import('../../query.js')

    // Build a simple user message for the subagent
    const userMessage = createUserMessage({ content: prompt })

    // Build a minimal system prompt for the subagent
    const systemPromptText = selectedAgent?.description
      ? `You are a specialized agent: ${selectedAgent.description}. Complete the task given to you.`
      : 'You are a helpful assistant. Complete the task given to you.'

    // Run the subagent via query()
    const agentMessages: Message[] = []
    let totalToolUseCount = 0

    try {
      const stream = query({
        messages: [userMessage],
        systemPrompt: asSystemPrompt([systemPromptText]),
        canUseTool,
        toolUseContext: {
          ...toolUseContext,
          // Give the subagent its own abort controller
          abortController: new AbortController(),
          messages: [userMessage],
        },
        querySource: 'agent:custom',
        maxTurns: 50,
        apiKey:
          (toolUseContext as { apiKey?: string }).apiKey ?? '',
        baseURL: (toolUseContext as { baseURL?: string }).baseURL,
      })

      for await (const event of stream) {
        if ('type' in event) {
          if (event.type === 'assistant') {
            agentMessages.push(event as Message)
            // Count tool uses
            const content = (event as AssistantMessage).message
              .content
            for (const block of content) {
              if (block.type === 'tool_use') {
                totalToolUseCount++
              }
            }
          } else if (
            event.type === 'user' ||
            event.type === 'system'
          ) {
            agentMessages.push(event as Message)
          }
        }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      return {
        data: {
          status: 'completed',
          result: `Agent encountered an error: ${errorMessage(err)}`,
          prompt,
          totalToolUseCount,
          totalDurationMs: durationMs,
        },
      }
    }

    // Extract the last assistant message as the result
    let resultText = 'Agent completed with no output.'
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i]!
      if (msg.type === 'assistant') {
        const text = extractTextFromContent(
          (msg as AssistantMessage).message.content,
        )
        if (text.trim()) {
          resultText = text
          break
        }
      }
    }

    const durationMs = Date.now() - startTime

    return {
      data: {
        status: 'completed',
        result: resultText,
        prompt,
        totalToolUseCount,
        totalDurationMs: durationMs,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output, AgentToolProgress>)
