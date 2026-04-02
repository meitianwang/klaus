/**
 * MCP client adapter — simplified from claude-code's services/mcp/client.ts.
 * Provides a bridge between @modelcontextprotocol/sdk and the engine's MCPServerConnection interface.
 * Stripped: OAuth elicitation UI, analytics, feature flags, VCR, multiple transport modes.
 * Preserved: connection management, tool discovery, tool calling, resource listing.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListResourcesResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { MCPServerConnection, ServerResource } from '../../Tool.js'
import { createAbortController } from '../../utils/abortController.js'

// ============================================================================
// MCP Server Config
// ============================================================================

export interface MCPServerConfig {
  name: string
  transport:
    | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
    | { type: 'sse'; url: string; headers?: Record<string, string> }
}

// ============================================================================
// Create MCP Connection
// ============================================================================

export async function createMCPConnection(
  config: MCPServerConfig,
  signal?: AbortSignal,
): Promise<MCPServerConnection> {
  let transport: Transport

  if (config.transport.type === 'stdio') {
    transport = new StdioClientTransport({
      command: config.transport.command,
      args: config.transport.args,
      env: config.transport.env as Record<string, string> | undefined,
    })
  } else {
    transport = new SSEClientTransport(
      new URL(config.transport.url),
    )
  }

  const client = new Client(
    { name: `klaus-${config.name}`, version: '1.0.0' },
    { capabilities: {} },
  )

  await client.connect(transport)

  const connection: MCPServerConnection = {
    name: config.name,

    async listTools() {
      const result = await client.request(
        { method: 'tools/list' },
        ListToolsResultSchema,
      )
      return (result.tools ?? []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    },

    async callTool(name: string, args: Record<string, unknown>) {
      const result = await client.request(
        { method: 'tools/call', params: { name, arguments: args } },
        CallToolResultSchema,
      )
      return result
    },

    async close() {
      await client.close()
    },
  }

  return connection
}

// ============================================================================
// Fetch resources for a connection
// ============================================================================

export async function fetchResourcesForClient(
  connection: MCPServerConnection,
  client: Client,
): Promise<ServerResource[]> {
  try {
    const result = await client.request(
      { method: 'resources/list' },
      ListResourcesResultSchema,
    )
    return (result.resources ?? []).map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }))
  } catch {
    return []
  }
}
