import type { LLMProviderFactory, AgentTool } from "klaus-agent";

export interface ModelPreset {
  readonly id: string;
  readonly label: string;
  readonly tokens: number;
}

export interface ProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly defaultBaseUrl: string;
  readonly models: readonly ModelPreset[];
  readonly factory?: LLMProviderFactory;
  readonly tools?: (apiKey: string, baseUrl: string, model: string) => AgentTool[];
}
