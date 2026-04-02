import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "../klaus-agent-compat.js";
import type { ProviderAPI } from "../capabilities/types.js";

export interface ModelPreset {
  readonly id: string;
  readonly label: string;
  readonly tokens: number;
}

export interface OAuthAuthConfig {
  readonly clientId: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: string;
  readonly extraParams?: Readonly<Record<string, string>>;
}

export type ProviderAuthMethod =
  | { readonly type: "api_key"; readonly label: string }
  | { readonly type: "oauth"; readonly label: string } & OAuthAuthConfig;

export interface ProviderAuth {
  readonly method: ProviderAuthMethod;
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
  readonly tools?: (apiKey: string, baseUrl: string, model: string) => AgentTool[];
  readonly auth?: ProviderAuth;
  readonly catalog?: (apiKey?: string, baseUrl?: string) => Promise<ModelPreset[]>;
  readonly hooks?: ProviderHooks;
  readonly register?: (api: ProviderAPI) => void;
}
