/**
 * Feishu SDK client factory with timeout, proxy, and caching.
 * Aligned with OpenClaw's extensions/feishu/src/client.ts
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig, FeishuDomain } from "./feishu-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default HTTP timeout for Feishu API requests (30 seconds). */
export const FEISHU_HTTP_TIMEOUT_MS = 30_000;
export const FEISHU_HTTP_TIMEOUT_MAX_MS = 300_000;
export const FEISHU_MEDIA_HTTP_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Domain resolution
// ---------------------------------------------------------------------------

export function resolveDomain(domain?: FeishuDomain): Lark.Domain | string {
  if (domain === "lark") return Lark.Domain.Lark;
  if (domain === "feishu" || !domain) return Lark.Domain.Feishu;
  return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}

// ---------------------------------------------------------------------------
// HTTP timeout wrapper
// ---------------------------------------------------------------------------

/**
 * Create an HTTP instance that delegates to the Lark SDK's default instance
 * but injects a default request timeout to prevent indefinite hangs.
 */
function createTimeoutHttpInstance(defaultTimeoutMs: number): Lark.HttpInstance {
  const base: Lark.HttpInstance =
    Lark.defaultHttpInstance as unknown as Lark.HttpInstance;

  function injectTimeout<D>(opts?: Lark.HttpRequestOptions<D>): Lark.HttpRequestOptions<D> {
    return { timeout: defaultTimeoutMs, ...opts } as Lark.HttpRequestOptions<D>;
  }

  return {
    request: (opts) => base.request(injectTimeout(opts)),
    get: (url, opts) => base.get(url, injectTimeout(opts)),
    post: (url, data, opts) => base.post(url, data, injectTimeout(opts)),
    put: (url, data, opts) => base.put(url, data, injectTimeout(opts)),
    patch: (url, data, opts) => base.patch(url, data, injectTimeout(opts)),
    delete: (url, opts) => base.delete(url, injectTimeout(opts)),
    head: (url, opts) => base.head(url, injectTimeout(opts)),
    options: (url, opts) => base.options(url, injectTimeout(opts)),
  };
}

// ---------------------------------------------------------------------------
// Proxy support
// ---------------------------------------------------------------------------

async function getWsProxyAgent(): Promise<unknown | undefined> {
  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  try {
    // Dynamic import — optional peer dependency, use variable to bypass TS static resolution
    const moduleName = "https-proxy-agent";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* webpackIgnore: true */ moduleName);
    const Agent = mod.HttpsProxyAgent ?? mod.default?.HttpsProxyAgent ?? mod.default;
    return Agent ? new Agent(proxyUrl) : undefined;
  } catch {
    console.warn("[Feishu] https-proxy-agent not installed, proxy settings ignored");
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Client cache
// ---------------------------------------------------------------------------

type CachedClient = {
  client: Lark.Client;
  config: { appId: string; appSecret: string; domain?: FeishuDomain; httpTimeoutMs: number };
};

const clientCache = new Map<string, CachedClient>();

function resolveHttpTimeoutMs(config: FeishuConfig, overrideMs?: number): number {
  if (overrideMs && Number.isFinite(overrideMs) && overrideMs > 0) {
    return Math.min(Math.max(Math.floor(overrideMs), 1), FEISHU_HTTP_TIMEOUT_MAX_MS);
  }

  const envRaw = process.env.KLAUS_FEISHU_HTTP_TIMEOUT_MS;
  if (envRaw) {
    const envValue = Number(envRaw);
    if (Number.isFinite(envValue) && envValue > 0) {
      return Math.min(Math.max(Math.floor(envValue), 1), FEISHU_HTTP_TIMEOUT_MAX_MS);
    }
  }

  const configValue = config.httpTimeoutMs;
  if (typeof configValue === "number" && Number.isFinite(configValue) && configValue > 0) {
    return Math.min(Math.max(Math.floor(configValue), 1), FEISHU_HTTP_TIMEOUT_MAX_MS);
  }

  return FEISHU_HTTP_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create or get a cached Feishu API client.
 */
export function createFeishuClient(
  config: FeishuConfig,
  opts?: { httpTimeoutMs?: number },
): Lark.Client {
  const { appId, appSecret, domain } = config;
  const httpTimeoutMs = resolveHttpTimeoutMs(config, opts?.httpTimeoutMs);
  const cacheKey = "default";

  const cached = clientCache.get(cacheKey);
  if (
    cached &&
    cached.config.appId === appId &&
    cached.config.appSecret === appSecret &&
    cached.config.domain === domain &&
    cached.config.httpTimeoutMs === httpTimeoutMs
  ) {
    return cached.client;
  }

  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(domain),
    httpInstance: createTimeoutHttpInstance(httpTimeoutMs),
  });

  clientCache.set(cacheKey, {
    client,
    config: { appId, appSecret, domain, httpTimeoutMs },
  });

  return client;
}

/**
 * Create a Feishu WebSocket client for event subscription.
 */
export async function createFeishuWSClient(config: FeishuConfig): Promise<Lark.WSClient> {
  const { appId, appSecret, domain } = config;
  const agent = await getWsProxyAgent();

  return new Lark.WSClient({
    appId,
    appSecret,
    domain: resolveDomain(domain),
    loggerLevel: Lark.LoggerLevel.info,
    ...(agent ? { agent } : {}),
  });
}

/**
 * Create an event dispatcher for Feishu events.
 */
export function createEventDispatcher(config: FeishuConfig): Lark.EventDispatcher {
  return new Lark.EventDispatcher({
    encryptKey: config.encryptKey,
    verificationToken: config.verificationToken,
  });
}

/**
 * Probe bot identity via /open-apis/bot/v3/info.
 */
export async function probeBotIdentity(
  config: FeishuConfig,
  timeoutMs = 10_000,
): Promise<{ botOpenId?: string; botName?: string }> {
  type BotInfoResponse = {
    code: number;
    msg?: string;
    bot?: { bot_name?: string; open_id?: string };
    data?: { bot?: { bot_name?: string; open_id?: string } };
  };

  const client = createFeishuClient(config);
  try {
    const resp = await (client as unknown as { request(opts: unknown): Promise<BotInfoResponse> })
      .request({ method: "GET", url: "/open-apis/bot/v3/info", data: {}, timeout: timeoutMs });

    const bot = resp?.bot ?? resp?.data?.bot;
    return { botOpenId: bot?.open_id, botName: bot?.bot_name };
  } catch {
    return {};
  }
}

/**
 * Clear cached clients.
 */
export function clearClientCache(): void {
  clientCache.clear();
}
