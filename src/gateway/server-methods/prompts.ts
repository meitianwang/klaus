import type { PromptRecord, SettingsStore } from "../../settings-store.js";
import { GatewayError } from "../errors.js";
import { requireEntityId } from "./resource-utils.js";

function normalizePromptInput(
  input: Record<string, unknown>,
  existing?: PromptRecord,
): PromptRecord {
  const now = Date.now();
  const id = requireEntityId(
    "id" in input ? String(input.id ?? "") : (existing?.id ?? ""),
  );

  const content =
    "content" in input ? String(input.content ?? "") : (existing?.content ?? "");
  if (!existing && !content.trim()) {
    throw GatewayError.badRequest("content is required");
  }

  return {
    id,
    name:
      "name" in input
        ? String(input.name ?? id)
        : (existing?.name ?? id),
    content,
    isDefault: existing?.isDefault ?? Boolean(input.is_default),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function listGatewayAdminPrompts(params: {
  settingsStore: SettingsStore;
}): Promise<{ prompts: readonly PromptRecord[] }> {
  return { prompts: await params.settingsStore.listPrompts() };
}

export async function createGatewayAdminPrompt(params: {
  settingsStore: SettingsStore;
  input: Record<string, unknown>;
}): Promise<{ ok: true; prompt: PromptRecord }> {
  const prompt = normalizePromptInput(params.input);
  await params.settingsStore.upsertPrompt(prompt);
  if (params.input.is_default) {
    await params.settingsStore.setDefaultPrompt(prompt.id);
  }
  return { ok: true, prompt: (await params.settingsStore.getPrompt(prompt.id)) ?? prompt };
}

export async function updateGatewayAdminPrompt(params: {
  settingsStore: SettingsStore;
  id: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: true; prompt: PromptRecord }> {
  const existing = await params.settingsStore.getPrompt(params.id);
  if (!existing) {
    throw GatewayError.notFound("prompt not found");
  }
  const prompt = normalizePromptInput({ ...params.patch, id: params.id }, existing);
  await params.settingsStore.upsertPrompt(prompt);
  if (params.patch.is_default) {
    await params.settingsStore.setDefaultPrompt(prompt.id);
  }
  return { ok: true, prompt: (await params.settingsStore.getPrompt(prompt.id)) ?? prompt };
}

export async function deleteGatewayAdminPrompt(params: {
  settingsStore: SettingsStore;
  id: string;
}): Promise<boolean> {
  return params.settingsStore.deletePrompt(requireEntityId(params.id));
}
