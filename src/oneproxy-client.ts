/**
 * OneProxy model list client with caching.
 *
 * Fetches available models from a running OneProxy instance
 * (OpenAI-compatible GET /v1/models endpoint).
 */

export interface OneProxyModel {
  readonly id: string;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedModels: OneProxyModel[] | undefined;
let cachedAt = 0;
let cachedBaseUrl = "";

export function clearModelCache(): void {
  cachedModels = undefined;
  cachedAt = 0;
  cachedBaseUrl = "";
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch available models from OneProxy.
 * Returns cached result if within TTL and baseUrl hasn't changed.
 * On failure returns an empty array and logs a warning.
 */
export async function fetchOneProxyModels(
  baseUrl: string,
): Promise<OneProxyModel[]> {
  const now = Date.now();
  if (
    cachedModels &&
    cachedBaseUrl === baseUrl &&
    now - cachedAt < CACHE_TTL_MS
  ) {
    return cachedModels;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[oneproxy] GET ${url} returned ${res.status}`);
      return cachedModels ?? [];
    }

    const body = (await res.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };

    const models: OneProxyModel[] = (body.data ?? []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
    }));

    cachedModels = models;
    cachedAt = now;
    cachedBaseUrl = baseUrl;

    return models;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[oneproxy] Failed to fetch models from ${url}: ${msg}`);
    return cachedModels ?? [];
  }
}
