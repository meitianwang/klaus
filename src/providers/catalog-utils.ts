import type { ModelPreset } from "./types.js";

const DEFAULT_TOKENS = 128000;

interface OpenAIModel {
  readonly id: string;
  readonly owned_by?: string;
}

interface FetchOptions {
  readonly excludePrefix?: readonly string[];
  readonly includePrefix?: readonly string[];
  readonly defaultTokens?: number;
  readonly knownTokens?: Readonly<Record<string, number>>;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function fetchOpenAICompatibleModels(
  apiKey: string,
  baseUrl: string,
  opts?: FetchOptions,
): Promise<ModelPreset[]> {
  if (!apiKey) return [];
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, ...opts?.headers },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: OpenAIModel[] };
  const data = json.data ?? [];

  const exclude = opts?.excludePrefix ?? ["embedding", "text-embedding", "tts", "dall-e", "whisper", "davinci", "babbage"];
  const include = opts?.includePrefix;
  const known = opts?.knownTokens ?? {};
  const defaultTokens = opts?.defaultTokens ?? DEFAULT_TOKENS;

  return data
    .filter((m) => {
      const id = m.id.toLowerCase();
      if (exclude.some((p) => id.startsWith(p))) return false;
      if (include && !include.some((p) => id.startsWith(p))) return false;
      return true;
    })
    .map((m) => ({
      id: m.id,
      label: m.id,
      tokens: known[m.id] ?? defaultTokens,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface AnthropicModel {
  readonly id: string;
  readonly display_name?: string;
}

export async function fetchAnthropicModels(
  apiKey: string,
  baseUrl: string,
): Promise<ModelPreset[]> {
  if (!apiKey) return [];
  const normalized = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const url = `${normalized}/v1/models`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: AnthropicModel[] };
  const data = json.data ?? [];

  return data
    .filter((m) => m.id.startsWith("claude-"))
    .map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
      tokens: 200000,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface GoogleModel {
  readonly name: string;
  readonly displayName?: string;
  readonly inputTokenLimit?: number;
}

export async function fetchGoogleModels(
  apiKey: string,
  _baseUrl: string,
): Promise<ModelPreset[]> {
  if (!apiKey) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { models?: GoogleModel[] };
  const models = json.models ?? [];

  return models
    .filter((m) => m.name.startsWith("models/gemini"))
    .map((m) => ({
      id: m.name.replace("models/", ""),
      label: m.displayName || m.name.replace("models/", ""),
      tokens: m.inputTokenLimit ?? 1048576,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
