import type {
  ModelCostRecord,
  ModelRecord,
  ModelRole,
  SettingsStore,
} from "../../settings-store.js";
import { GatewayError } from "../errors.js";
import { requireEntityId } from "./resource-utils.js";

function parseModelCost(parsed: Record<string, unknown>): ModelCostRecord | undefined {
  const input = Number(parsed.cost_input);
  const output = Number(parsed.cost_output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    return undefined;
  }
  const cacheRead = Number(parsed.cost_cache_read);
  const cacheWrite = Number(parsed.cost_cache_write);
  return {
    input,
    output,
    ...(Number.isFinite(cacheRead) && cacheRead >= 0 ? { cacheRead } : {}),
    ...(Number.isFinite(cacheWrite) && cacheWrite >= 0 ? { cacheWrite } : {}),
  };
}

const VALID_ROLES = new Set<string>(["sonnet", "haiku", "opus"]);

function validateRole(raw: unknown): ModelRole | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  return VALID_ROLES.has(raw) ? (raw as ModelRole) : undefined;
}

function sanitizeModel(model: ModelRecord): Record<string, unknown> {
  const { apiKey, refreshToken, ...safe } = model;
  return {
    ...safe,
    isAuthorized: !!apiKey,
  };
}

function normalizeModelInput(
  input: Record<string, unknown>,
  existing?: ModelRecord,
): ModelRecord {
  const now = Date.now();
  const id = requireEntityId(
    "id" in input ? String(input.id ?? "") : (existing?.id ?? ""),
  );

  const provider =
    "provider" in input ? String(input.provider ?? "").trim() : (existing?.provider ?? "");
  const model =
    "model" in input ? String(input.model ?? "").trim() : (existing?.model ?? "");
  if (!provider || !model) {
    throw GatewayError.badRequest("provider and model are required");
  }

  const maxContextTokens =
    "max_context_tokens" in input
      ? Number(input.max_context_tokens)
      : (existing?.maxContextTokens ?? 200_000);
  if (
    !Number.isFinite(maxContextTokens) ||
    maxContextTokens < 1000 ||
    maxContextTokens > 2_000_000
  ) {
    throw GatewayError.badRequest("max_context_tokens must be 1000-2000000");
  }

  const shouldUpdateCost = "cost_input" in input;
  const cost = shouldUpdateCost ? parseModelCost(input) : existing?.cost;

  return {
    id,
    name:
      "name" in input
        ? String(input.name ?? id)
        : (existing?.name ?? id),
    provider,
    model,
    ...("api_key" in input
      ? { apiKey: input.api_key ? String(input.api_key) : undefined }
      : existing?.apiKey != null
        ? { apiKey: existing.apiKey }
        : {}),
    ...("base_url" in input
      ? { baseUrl: input.base_url ? String(input.base_url) : undefined }
      : existing?.baseUrl != null
        ? { baseUrl: existing.baseUrl }
        : {}),
    maxContextTokens,
    thinking:
      "thinking" in input
        ? String(input.thinking ?? "off")
        : (existing?.thinking ?? "off"),
    isDefault: existing?.isDefault ?? Boolean(input.is_default),
    ...("role" in input
      ? { role: validateRole(input.role) }
      : existing?.role
        ? { role: existing.role }
        : {}),
    ...(cost ? { cost } : {}),
    ...(existing?.authType ? { authType: existing.authType } : {}),
    ...(existing?.refreshToken ? { refreshToken: existing.refreshToken } : {}),
    ...(existing?.tokenExpiresAt != null
      ? { tokenExpiresAt: existing.tokenExpiresAt }
      : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function listGatewayAdminModels(params: {
  settingsStore: SettingsStore;
}): Promise<{ models: readonly unknown[] }> {
  return {
    models: (await params.settingsStore.listModels()).map((model) => sanitizeModel(model)),
  };
}

export async function createGatewayAdminModel(params: {
  settingsStore: SettingsStore;
  input: Record<string, unknown>;
}): Promise<{ ok: true; model: unknown }> {
  const model = normalizeModelInput(params.input);
  await params.settingsStore.upsertModel(model);
  if (params.input.is_default) {
    await params.settingsStore.setDefaultModel(model.id);
  }
  if (model.role) {
    await params.settingsStore.setModelRole(model.id, model.role);
  }
  const stored = (await params.settingsStore.getModel(model.id)) ?? model;
  return { ok: true, model: sanitizeModel(stored) };
}

export async function updateGatewayAdminModel(params: {
  settingsStore: SettingsStore;
  id: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: true; model: unknown }> {
  const existing = await params.settingsStore.getModel(params.id);
  if (!existing) {
    throw GatewayError.notFound("model not found");
  }
  const model = normalizeModelInput({ ...params.patch, id: params.id }, existing);
  await params.settingsStore.upsertModel(model);
  if (params.patch.is_default) {
    await params.settingsStore.setDefaultModel(model.id);
  }
  if ("role" in params.patch) {
    await params.settingsStore.setModelRole(model.id, model.role ?? null);
  }
  const stored = (await params.settingsStore.getModel(model.id)) ?? model;
  return { ok: true, model: sanitizeModel(stored) };
}

export async function deleteGatewayAdminModel(params: {
  settingsStore: SettingsStore;
  id: string;
}): Promise<boolean> {
  return params.settingsStore.deleteModel(requireEntityId(params.id));
}

export async function updateGatewayModelOAuthTokens(params: {
  settingsStore: SettingsStore;
  modelId: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}): Promise<boolean> {
  const existing = await params.settingsStore.getModel(params.modelId);
  if (!existing) {
    return false;
  }
  await params.settingsStore.upsertModel({
    ...existing,
    apiKey: params.accessToken,
    authType: "oauth",
    refreshToken: params.refreshToken,
    tokenExpiresAt: params.expiresInSeconds
      ? Date.now() + params.expiresInSeconds * 1000
      : undefined,
    updatedAt: Date.now(),
  });
  return true;
}
