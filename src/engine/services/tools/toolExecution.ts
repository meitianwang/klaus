/**
 * Tool execution — adapted from claude-code's services/tools/toolExecution.ts.
 * Stripped: analytics, telemetry, speculative classifier, OTel tracing, session activity.
 * Preserved: input validation, permission checking, tool calling, error handling, progress.
 */

import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import {
  findToolByName,
  type Tool,
  type ToolProgress,
  type ToolProgressData,
  type ToolUseContext,
  type CanUseToolFn,
} from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  ProgressMessage,
  UserMessage,
} from '../../types/message.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  executePreToolHooks,
  executePostToolHooks,
} from '../../../hooks.js'

// ============================================================================
// Constants
// ============================================================================

const CANCEL_MESSAGE =
  'The tool use was interrupted by the user. The tool was NOT executed. Consider what the user wants and whether you should re-run the tool, run a different tool, or respond without running a tool.'

// ============================================================================
// Types
// ============================================================================

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}

// ============================================================================
// Error Classification
// ============================================================================

export function classifyToolError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('abort')) {
      return 'AbortError'
    }
    if ('code' in error) {
      const code = (error as { code: string }).code
      if (code === 'ENOENT') return 'FileNotFoundError'
      if (code === 'EACCES' || code === 'EPERM') return 'PermissionError'
      if (code === 'ETIMEDOUT') return 'TimeoutError'
    }
    return error.constructor.name || 'Error'
  }
  return 'UnknownError'
}

// ============================================================================
// Helper: Create user message with tool result
// ============================================================================

function createUserMessage(params: {
  content: (ToolResultBlockParam | { type: 'text'; text: string })[]
  toolUseResult?: unknown
  sourceToolAssistantUUID?: ReturnType<typeof randomUUID>
}): UserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: params.content,
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    toolUseResult: params.toolUseResult,
    sourceToolAssistantUUID: params.sourceToolAssistantUUID,
  } as UserMessage
}

function createProgressMessage<P extends ToolProgressData>(params: {
  toolUseID: string
  parentToolUseID: string
  data: P
}): ProgressMessage<P> {
  return {
    type: 'progress',
    data: params.data,
    toolUseID: params.toolUseID,
    parentToolUseID: params.parentToolUseID,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Schema hint for deferred tools
// ============================================================================

export function buildSchemaNotSentHint(
  tool: Tool,
  messages: Message[],
  tools: readonly Tool[],
): string | null {
  if (!tool.shouldDefer) return null
  // Check if tool_reference for this tool exists in messages
  // If not, the model is calling a deferred tool without discovering it first
  return `\n\nNote: The schema for "${tool.name}" was not included in the initial prompt. Please use ToolSearch to discover the tool's schema before calling it.`
}

// ============================================================================
// Format Zod validation error
// ============================================================================

function formatZodValidationError(toolName: string, error: { message: string; issues?: unknown[] }): string {
  return `Tool "${toolName}" input validation failed: ${error.message}`
}

// ============================================================================
// Core: runToolUse
// ============================================================================

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const toolName = toolUse.name
  const tool = findToolByName(toolUseContext.options.tools, toolName)

  // Tool not found
  if (!tool) {
    console.warn(`[ToolExecution] Unknown tool: ${toolName}`)
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>Error: No such tool available: ${toolName}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: `Error: No such tool available: ${toolName}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  const toolInput = toolUse.input as { [key: string]: unknown }

  try {
    // Check if aborted
    if (toolUseContext.abortController.signal.aborted) {
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: CANCEL_MESSAGE,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: CANCEL_MESSAGE,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }

    const results = await checkPermissionsAndCallTool(
      tool,
      toolUse.id,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
    )

    for (const result of results) {
      yield result
    }
  } catch (error) {
    const errorType = classifyToolError(error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[ToolExecution] ${tool.name} error (${errorType}):`, errorMsg)

    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${errorType}: ${errorMsg}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: `${errorType}: ${errorMsg}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
  }
}

// ============================================================================
// Core: checkPermissionsAndCallTool
// ============================================================================

async function checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: unknown },
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
): Promise<MessageUpdateLazy[]> {
  // 1. Validate input with zod
  const parsedInput = tool.inputSchema.safeParse(input)
  if (!parsedInput.success) {
    const errorContent = formatZodValidationError(tool.name, parsedInput.error)
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // 2. Tool-specific validation
  const isValidCall = await tool.validateInput?.(
    parsedInput.data,
    toolUseContext,
  )
  if (isValidCall?.result === false) {
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${isValidCall.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `Error: ${isValidCall.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // 3. Check permissions
  const permissionResult = await canUseTool(
    tool,
    parsedInput.data,
    assistantMessage,
    toolUseContext,
  )

  if (permissionResult.behavior === 'deny') {
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: permissionResult.message,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: permissionResult.message,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  if (permissionResult.behavior === 'ask') {
    // In server context (Klaus), we auto-approve or deny based on yolo mode
    // The canUseTool function should handle this
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: permissionResult.message || 'Permission denied',
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: permissionResult.message || 'Permission denied',
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // 4. Use updatedInput if permission system modified it
  let finalInput = (permissionResult as any).updatedInput ?? parsedInput.data

  // 4.5 PreToolUse hooks
  const hooksConfig = toolUseContext.options.hooksConfig
  if (hooksConfig) {
    const preResult = await executePreToolHooks(
      hooksConfig,
      tool.name,
      finalInput,
      toolUseID,
      toolUseContext.abortController.signal,
    )
    if (preResult.blocked) {
      return [
        {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Hook blocked: ${preResult.reason}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: `Hook blocked: ${preResult.reason}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        },
      ]
    }
    if (preResult.updatedInput) {
      finalInput = preResult.updatedInput
    }
  }

  // 5. Call the tool
  const progressMessages: ProgressMessage[] = []
  const onProgress = (progress: ToolProgress<ToolProgressData>) => {
    progressMessages.push(
      createProgressMessage({
        toolUseID,
        parentToolUseID: toolUseID,
        data: progress.data,
      }),
    )
  }

  const startTime = Date.now()
  const result = await tool.call(
    finalInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    onProgress,
  )
  const durationMs = Date.now() - startTime

  console.log(`[ToolExecution] ${tool.name} completed in ${durationMs}ms`)

  // 5.5 PostToolUse hooks
  if (hooksConfig) {
    await executePostToolHooks(
      hooksConfig,
      tool.name,
      finalInput,
      result.data,
      toolUseID,
      toolUseContext.abortController.signal,
    )
  }

  // 6. Build result messages
  const resultMessages: MessageUpdateLazy[] = []

  // Add any new messages from the tool result
  if (result.newMessages) {
    for (const msg of result.newMessages) {
      resultMessages.push({ message: msg })
    }
  }

  // Map tool result to API format
  const toolResultBlock = tool.mapToolResultToToolResultBlockParam(
    result.data,
    toolUseID,
  )

  const resultMessage = createUserMessage({
    content: [toolResultBlock],
    toolUseResult: result.data,
    sourceToolAssistantUUID: assistantMessage.uuid,
  })

  // Add MCP metadata if present
  if (result.mcpMeta) {
    ;(resultMessage as any).mcpMeta = result.mcpMeta
  }

  const update: MessageUpdateLazy = {
    message: resultMessage,
  }

  // Add context modifier if present
  if (result.contextModifier) {
    update.contextModifier = {
      toolUseID,
      modifyContext: result.contextModifier,
    }
  }

  resultMessages.push(update)
  return resultMessages
}
