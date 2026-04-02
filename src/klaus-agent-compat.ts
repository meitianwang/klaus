/**
 * Compatibility shim — re-exports types that were previously imported from "klaus-agent".
 * Existing tool/provider/capability files import from here instead of "klaus-agent".
 * This allows gradual migration to engine types without touching every tool file.
 */

// AgentTool: Klaus's own tool interface (used by memory, skills, etc.)
// These tools use the legacy execute() signature, not the engine's call() signature.
export interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    ctx: ToolExecutionContext,
  ): Promise<AgentToolResult>;
}

export interface AgentToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}

export interface ToolExecutionContext {
  signal: AbortSignal;
  onUpdate: (...args: unknown[]) => void;
  approval: {
    isYolo(): boolean;
    request?(...args: unknown[]): Promise<boolean>;
    [key: string]: unknown;
  };
  agentName: string;
}

// Hook types (used by tool-loop-detector.ts, capabilities/types.ts, providers/types.ts)
export interface BeforeToolCallContext {
  toolName: string;
  args: unknown;
  toolCallId: string;
  sessionKey?: string;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallContext {
  toolName: string;
  toolCallId: string;
  result?: unknown;
  error?: unknown;
}

export interface AfterToolCallResult {
  result?: unknown;
  error?: unknown;
}

// Additional types needed by moonshot provider
export interface LLMRequestOptions {
  model: string;
  systemPrompt: string;
  messages: any[];
  tools: any[];
  thinkingLevel: any;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AssistantMessageEvent {
  type: string;
  [key: string]: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  [key: string]: unknown;
}

export type Message = {
  role: string;
  content: any;
  [key: string]: unknown;
}

// AgentEvent (legacy — replaced by EngineEvent, kept for any remaining references)
export type AgentEvent =
  | { type: "message_update"; event: { type: "text"; text: string } | { type: "thinking"; thinking: string } }
  | { type: "tool_execution_start"; toolName: string; toolCallId: string; args: unknown }
  | { type: "tool_execution_end"; toolName: string; toolCallId: string; isError: boolean }
  | { type: "compaction_end" }
  | { type: "error"; error: Error };

// Re-export engine types that map to old klaus-agent types
export type { Message as AgentMessage } from "./engine/types/message.js";
export type ThinkingLevel = string;

// AssistantMessage compat (legacy shape for providers that still reference it)
export interface AssistantMessage {
  role: "assistant";
  content: any[];
  [key: string]: unknown;
}

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxContextTokens: number;
  cost?: unknown;
}

export interface MCPServerConfig {
  name: string;
  transport:
    | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> };
}

export interface MCPClient {
  connect(): Promise<void>;
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }>;
  close(): Promise<void>;
}

export interface Approval {
  request(...args: unknown[]): Promise<boolean>;
  fetchRequest(...args: unknown[]): Promise<unknown>;
  resolve(...args: unknown[]): void;
  setYolo(...args: unknown[]): void;
  isYolo(): boolean;
  autoApproveActions: Set<string>;
  share(): Approval;
  dispose(): void;
}
