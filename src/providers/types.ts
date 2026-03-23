import type {
  LLMProviderFactory,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "klaus-agent";
import type { ProviderAPI } from "../capabilities/types.js";

export interface ModelPreset {
  readonly id: string;
  readonly label: string;
  readonly tokens: number;
}

export interface ProviderAuth {
  readonly envVar?: string;
  readonly label?: string;
}

export interface ProviderHooks {
  readonly beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | void>;
  readonly afterToolCall?: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult | void>;
}

export interface ProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly defaultBaseUrl: string;
  readonly models: readonly ModelPreset[];
  readonly factory?: LLMProviderFactory;
  readonly tools?: (apiKey: string, baseUrl: string, model: string) => AgentTool[];
  readonly auth?: ProviderAuth;
  readonly catalog?: (apiKey?: string, baseUrl?: string) => Promise<ModelPreset[]>;
  readonly hooks?: ProviderHooks;
  readonly register?: (api: ProviderAPI) => void;
}
