/**
 * MCP Manager — connects to configured MCP servers and produces engine-compatible
 * MCPServerConnection[] and per-server Tool[] wrappers (mcp__<server>__<tool>).
 *
 * Lifecycle: construct → connect() → use mcpClients/mcpTools → close()
 * Follows claude-code's pattern: tools are named mcp__<server>__<tool>,
 * each wrapping MCPTool with server-specific call/description/schema.
 */

import type { SettingsStore, McpServerRecord } from "./settings-store.js";
import {
  createMCPConnection,
  type MCPServerConfig,
} from "./engine/services/mcp/client.js";
import type { MCPServerConnection, ServerResource } from "./engine/Tool.js";
import { MCPTool } from "./engine/tools/MCPTool/MCPTool.js";
import type { Tool } from "./engine/Tool.js";

// ============================================================================
// Name normalization (from claude-code's mcp normalization)
// ============================================================================

function normalizeNameForMCP(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__${normalizeNameForMCP(toolName)}`;
}

// ============================================================================
// MCP Manager
// ============================================================================

interface ConnectedServer {
  connection: MCPServerConnection;
  tools: Tool[];
  resources: ServerResource[];
}

export class MCPManager {
  private readonly store: SettingsStore;
  private servers = new Map<string, ConnectedServer>();

  constructor(store: SettingsStore) {
    this.store = store;
  }

  /** Connect to all enabled MCP servers. Safe to call multiple times. */
  async connect(): Promise<void> {
    const records = this.store.getEnabledMcpServers();
    if (records.length === 0) return;

    const results = await Promise.allSettled(
      records.map((r) => this.connectOne(r)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const record = records[i]!;
      if (result.status === "rejected") {
        console.error(
          `[MCP] Failed to connect to "${record.name}": ${result.reason}`,
        );
      }
    }
  }

  /** Reconnect: close all, then connect again from current config. */
  async reconnect(): Promise<void> {
    await this.close();
    await this.connect();
  }

  /** All active MCPServerConnection instances (for ToolUseContext.options.mcpClients). */
  get mcpClients(): MCPServerConnection[] {
    return [...this.servers.values()].map((s) => s.connection);
  }

  /** All wrapped MCP tools (mcp__server__tool) ready to add to the tool pool. */
  get mcpTools(): Tool[] {
    return [...this.servers.values()].flatMap((s) => s.tools);
  }

  /** Resources keyed by server name (for ToolUseContext.options.mcpResources). */
  get mcpResources(): Record<string, ServerResource[]> {
    const result: Record<string, ServerResource[]> = {};
    for (const [, server] of this.servers) {
      if (server.resources.length > 0) {
        result[server.connection.name] = server.resources;
      }
    }
    return result;
  }

  /** Close all connections. */
  async close(): Promise<void> {
    const closes = [...this.servers.values()].map((s) =>
      s.connection.close().catch((err) => {
        console.error(`[MCP] Error closing "${s.connection.name}": ${err}`);
      }),
    );
    await Promise.all(closes);
    this.servers.clear();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async connectOne(record: McpServerRecord): Promise<void> {
    const config: MCPServerConfig = {
      name: record.name,
      transport: record.transport,
    };

    const connection = await createMCPConnection(config);
    console.log(`[MCP] Connected to "${record.name}"`);

    // Discover tools
    const rawTools = await connection.listTools();
    const wrappedTools = rawTools.map((t) =>
      this.wrapMcpTool(connection, record.name, t),
    );
    console.log(
      `[MCP] "${record.name}" provides ${wrappedTools.length} tool(s): ${rawTools.map((t) => t.name).join(", ")}`,
    );

    this.servers.set(record.id, {
      connection,
      tools: wrappedTools,
      resources: [], // Resources populated lazily via ListMcpResourcesTool
    });
  }

  /**
   * Wrap a single MCP server tool as an engine Tool.
   * Follows claude-code's pattern: spread MCPTool base, override name/description/call.
   */
  private wrapMcpTool(
    connection: MCPServerConnection,
    serverName: string,
    mcpTool: { name: string; description?: string; inputSchema?: unknown },
  ): Tool {
    const fullyQualifiedName = buildMcpToolName(serverName, mcpTool.name);
    const desc = mcpTool.description ?? "";
    const MAX_DESC = 2048;
    const truncatedDesc =
      desc.length > MAX_DESC ? desc.slice(0, MAX_DESC) + "... [truncated]" : desc;

    return {
      ...MCPTool,
      name: fullyQualifiedName,
      isMcp: true,
      async description() {
        return truncatedDesc;
      },
      async prompt() {
        return truncatedDesc;
      },
      inputJSONSchema: (mcpTool.inputSchema as Tool["inputJSONSchema"]) ?? {
        type: "object" as const,
        properties: {},
      },
      async call(
        args: Record<string, unknown>,
        context,
      ) {
        const result = await connection.callTool(mcpTool.name, args);

        // Normalize result to string
        let text: string;
        if (typeof result === "string") {
          text = result;
        } else if (
          result &&
          typeof result === "object" &&
          "content" in result &&
          Array.isArray((result as any).content)
        ) {
          // Standard MCP CallToolResult: { content: [{type: "text", text: "..."}] }
          text = (result as any).content
            .map((c: any) => c.text ?? JSON.stringify(c))
            .join("\n");
        } else {
          text = JSON.stringify(result);
        }

        return { data: text };
      },
      userFacingName: () => fullyQualifiedName,
    } as Tool;
  }
}
