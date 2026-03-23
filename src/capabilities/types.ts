import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentTool } from "klaus-agent";

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
  registerWebSearch(provider: WebSearchProvider): void;
  registerMediaUnderstanding(provider: MediaUnderstandingProvider): void;
  registerSpeech(provider: SpeechProvider): void;
  registerImageGeneration(provider: ImageGenerationProvider): void;
  registerHttpRoute(route: HttpRouteDefinition): void;
  registerCommand(command: CommandDefinition): void;
  registerService(service: ServiceDefinition): void;
}
