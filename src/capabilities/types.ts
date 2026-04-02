import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AgentTool,
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "../klaus-agent-compat.js";

// --- Tools (aligned with openclaw registerTool) ---

export type ToolFactory = (ctx: { apiKey?: string; baseUrl?: string }) => AgentTool | AgentTool[] | null;

// --- Lifecycle Hooks (aligned with openclaw on(hookName)) ---

export type HookName =
  | "agent_start"
  | "agent_end"
  | "before_tool_call"
  | "after_tool_call"
  | "message_start"
  | "message_end";

export type HookHandler<T extends HookName> =
  T extends "agent_start" ? () => void | Promise<void> :
  T extends "agent_end" ? (event: { sessionKey: string }) => void | Promise<void> :
  T extends "before_tool_call" ? (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | void> :
  T extends "after_tool_call" ? (ctx: AfterToolCallContext) => Promise<AfterToolCallResult | void> :
  T extends "message_start" ? (event: AgentEvent) => void :
  T extends "message_end" ? (event: AgentEvent) => void :
  never;

export interface HookRegistration {
  readonly name: HookName;
  readonly handler: (...args: unknown[]) => unknown;
  readonly priority?: number;
}

// --- Web Search (aligned with openclaw WebSearchProviderPlugin) ---

export interface WebSearchProvider {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly envVars: string[];
  readonly requiresCredential?: boolean;
  readonly credentialLabel?: string;
  readonly autoDetectOrder?: number;
  createTool: (ctx: { apiKey?: string; baseUrl?: string }) => AgentTool | null;
}

// --- Media Understanding (aligned with openclaw MediaUnderstandingProvider) ---

export interface MediaUnderstandingProvider {
  readonly id: string;
  readonly capabilities?: ("audio" | "video" | "image")[];
  transcribeAudio?: (req: { filePath: string; mime?: string; signal?: AbortSignal }) => Promise<{ text: string }>;
  describeVideo?: (req: { filePath: string; prompt?: string; signal?: AbortSignal }) => Promise<{ description: string }>;
  describeImage?: (req: { filePath: string; prompt?: string; signal?: AbortSignal }) => Promise<{ description: string }>;
}

// --- Speech / TTS (aligned with openclaw SpeechProviderPlugin) ---

export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  readonly aliases?: string[];
  readonly models?: readonly string[];
  readonly voices?: readonly string[];
  isConfigured: () => boolean;
  synthesize: (req: { text: string; voice?: string; model?: string; signal?: AbortSignal }) => Promise<{ audio: Buffer; contentType: string }>;
  listVoices?: () => Promise<{ id: string; name: string; language?: string }[]>;
}

// --- Image Generation (aligned with openclaw ImageGenerationProvider) ---

export interface ImageGenerationProvider {
  readonly id: string;
  readonly label?: string;
  readonly aliases?: string[];
  readonly defaultModel?: string;
  readonly models?: string[];
  generateImage: (req: { prompt: string; model?: string; size?: string; signal?: AbortSignal }) => Promise<{ url?: string; data?: Buffer; contentType?: string }>;
}

// --- HTTP Routes (aligned with openclaw OpenClawPluginHttpRouteParams) ---

export interface HttpRouteDefinition {
  readonly path: string;
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
  readonly auth?: "admin" | "user" | "none";
  readonly match?: "exact" | "prefix";
}

// --- Commands (aligned with openclaw OpenClawPluginCommandDefinition) ---

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly acceptsArgs?: boolean;
  readonly requireAuth?: boolean;
  handler: (ctx: { args: string; sessionKey: string; userId: string }) => Promise<{ text?: string; error?: string } | null>;
}

// --- Services (aligned with openclaw OpenClawPluginService) ---

export interface ServiceDefinition {
  readonly id: string;
  start: (ctx: { stateDir: string }) => void | Promise<void>;
  stop?: (ctx: { stateDir: string }) => void | Promise<void>;
}

// --- Provider API (registration surface) ---

export interface ProviderAPI {
  registerTool(tool: AgentTool | ToolFactory): void;
  registerWebSearch(provider: WebSearchProvider): void;
  registerMediaUnderstanding(provider: MediaUnderstandingProvider): void;
  registerSpeech(provider: SpeechProvider): void;
  registerImageGeneration(provider: ImageGenerationProvider): void;
  registerHttpRoute(route: HttpRouteDefinition): void;
  registerCommand(command: CommandDefinition): void;
  registerService(service: ServiceDefinition): void;
  on<T extends HookName>(name: T, handler: HookHandler<T>, opts?: { priority?: number }): void;
}
