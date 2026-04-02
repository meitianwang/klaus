/**
 * Tool registry — adapted from claude-code's tools.ts.
 * Registers all available tools for the engine.
 * Stripped: feature-gated tools, ant-only tools, conditional imports.
 * Preserved: core tool list, assembleToolPool.
 */

import type { Tool, Tools } from './Tool.js'

// Direct imports for core tools
import { BashTool } from './tools/BashTool/BashTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { WebFetchTool } from './tools/WebFetchTool/WebFetchTool.js'
import { AgentTool } from './tools/AgentTool/AgentTool.js'
import { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool.js'
import { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js'
import { TaskOutputTool } from './tools/TaskOutputTool/TaskOutputTool.js'
import { SkillTool } from './tools/SkillTool/SkillTool.js'

// MCP tools (registered dynamically based on connected servers)
import { MCPTool } from './tools/MCPTool/MCPTool.js'
import { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js'

/**
 * Get all base tools (without MCP tools).
 * MCP tools are added dynamically based on connected MCP servers.
 */
export function getAllBaseTools(): Tools {
  return [
    BashTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
    AgentTool,
    TodoWriteTool,
    NotebookEditTool,
    TaskStopTool,
    TaskOutputTool,
    SkillTool,
    ListMcpResourcesTool,
    ReadMcpResourceTool,
  ] as unknown as Tools
}

/**
 * Assemble the full tool pool, including MCP tools for connected servers.
 */
export function assembleToolPool(
  baseTools?: Tools,
  mcpTools?: Tool[],
): Tools {
  const tools = [...(baseTools ?? getAllBaseTools())]
  if (mcpTools) {
    tools.push(...mcpTools)
  }
  return tools as unknown as Tools
}

// Re-export individual tools for direct access
export {
  BashTool,
  FileReadTool,
  FileEditTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  WebFetchTool,
  AgentTool,
  TodoWriteTool,
  NotebookEditTool,
  TaskStopTool,
  TaskOutputTool,
  SkillTool,
  MCPTool,
  ListMcpResourcesTool,
  ReadMcpResourceTool,
}
