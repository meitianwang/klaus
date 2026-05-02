import type { SettingsStore } from "../../settings-store.js";
import type { ModelPreset } from "../../providers/types.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePKCE,
  generateState,
} from "../../auth/oauth.js";
import {
  getAllProviders,
  getProvider,
  reloadExternalProviders,
} from "../../providers/registry.js";
import { GatewayError } from "../errors.js";

export type PendingOAuth = {
  readonly verifier: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly redirectUri: string;
  readonly createdAt: number;
};

export type OAuthCallbackPage = {
  readonly title: string;
  readonly message?: string;
  readonly markCompleted?: boolean;
};

async function resolveProviderModels(params: {
  settingsStore: SettingsStore | null;
  providerId: string;
  refresh: boolean;
  staticModels: readonly ModelPreset[];
  catalog?: (apiKey?: string, baseUrl?: string) => Promise<ModelPreset[]>;
  defaultBaseUrl: string;
}): Promise<readonly ModelPreset[]> {
  let models = params.staticModels;
  if (!params.refresh || !params.catalog) {
    return models;
  }

  try {
    const allModels = params.settingsStore ? await params.settingsStore.listModels() : [];
    const stored = allModels.find(
      (model) => model.provider === params.providerId,
    );
    const apiKey = stored?.apiKey;
    const baseUrl = stored?.baseUrl || params.defaultBaseUrl;
    if (!apiKey) {
      return models;
    }
    const catalogModels = await Promise.race([
      params.catalog(apiKey, baseUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 8000),
      ),
    ]);
    if (catalogModels.length > 0) {
      models = catalogModels;
    }
  } catch {
    // Fall back to static models if provider catalog fetch fails.
  }

  return models;
}

export async function listGatewayAdminProviders(params: {
  settingsStore: SettingsStore | null;
  refresh?: boolean;
}): Promise<{
  providers: readonly {
    id: string;
    label: string;
    defaultBaseUrl: string;
    models: readonly ModelPreset[];
    auth?: unknown;
  }[];
}> {
  const refresh = Boolean(params.refresh);
  const providers = await Promise.all(
    getAllProviders().map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      defaultBaseUrl: provider.defaultBaseUrl,
      models: await resolveProviderModels({
        settingsStore: params.settingsStore,
        providerId: provider.id,
        refresh,
        staticModels: provider.models,
        catalog: provider.catalog,
        defaultBaseUrl: provider.defaultBaseUrl,
      }),
      ...(provider.auth ? { auth: provider.auth } : {}),
    })),
  );
  return { providers };
}

export async function reloadGatewayAdminProviders(): Promise<{
  ok: true;
  added: string[];
  removed: string[];
}> {
  const result = await reloadExternalProviders();
  return { ok: true, ...result };
}

export function beginGatewayProviderOAuth(params: {
  pendingOAuth: Map<string, PendingOAuth>;
  providerId: string;
  modelId: string;
  host?: string;
  protocol?: string;
  defaultPort: number;
}): { redirectTo: string } {
  if (!params.providerId || !params.modelId) {
    throw GatewayError.badRequest("provider and modelId required");
  }

  const providerDef = getProvider(params.providerId);
  if (!providerDef?.auth?.method || providerDef.auth.method.type !== "oauth") {
    throw GatewayError.badRequest("provider does not support OAuth");
  }

  const { verifier, challenge } = generatePKCE();
  const state = generateState();
  const host = params.host ?? `localhost:${params.defaultPort}`;
  const protocol = params.protocol === "https" ? "https" : "http";
  const redirectUri = `${protocol}://${host}/auth/provider/callback`;

  params.pendingOAuth.set(state, {
    verifier,
    modelId: params.modelId,
    providerId: params.providerId,
    redirectUri,
    createdAt: Date.now(),
  });

  return {
    redirectTo: buildAuthorizeUrl(
      providerDef.auth.method,
      redirectUri,
      state,
      challenge,
    ),
  };
}

export async function completeGatewayProviderOAuth(params: {
  pendingOAuth: Map<string, PendingOAuth>;
  code: string;
  state: string;
  error?: string | null;
  updateModelOAuthTokens: (params: {
    modelId: string;
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
  }) => Promise<boolean>;
}): Promise<OAuthCallbackPage> {
  if (params.error) {
    return {
      title: "Authorization failed",
      message: params.error,
    };
  }

  const pending = params.pendingOAuth.get(params.state);
  if (!pending) {
    return { title: "Invalid or expired state" };
  }
  params.pendingOAuth.delete(params.state);

  const providerDef = getProvider(pending.providerId);
  if (!providerDef?.auth?.method || providerDef.auth.method.type !== "oauth") {
    return { title: "Provider not found" };
  }

  try {
    const result = await exchangeCode(
      providerDef.auth.method,
      params.code,
      pending.redirectUri,
      pending.verifier,
    );
    const updated = await params.updateModelOAuthTokens({
      modelId: pending.modelId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresInSeconds: result.expiresIn,
    });
    if (!updated) {
      return {
        title: "Model not found",
        message: pending.modelId,
      };
    }
    return {
      title: "Authorization successful",
      message: "You can close this window.",
      markCompleted: true,
    };
  } catch (err) {
    return {
      title: "Token exchange failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

