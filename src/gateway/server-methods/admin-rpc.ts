import type {
  GatewayAdminRpcContext,
  GatewayRpcMethodDispatchResult,
} from "./admin-types.js";

export async function handleGatewayAdminRpcMethod(
  ctx: GatewayAdminRpcContext,
  method: string,
  params: Record<string, unknown>,
): Promise<GatewayRpcMethodDispatchResult> {
  switch (method) {
    case "models.list":
      try {
        return { handled: true, result: ctx.listAdminModels() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "models.add":
      try {
        return {
          handled: true,
          result: ctx.createAdminModel(
            (params.model ?? params) as Record<string, unknown>,
          ),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "models.update": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return {
          handled: true,
          result: ctx.updateAdminModel({
            id,
            patch: (params.patch ?? {}) as Record<string, unknown>,
          }),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "models.remove": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return { handled: true, result: { ok: ctx.deleteAdminModel(id) } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "prompts.list":
      try {
        return { handled: true, result: ctx.listAdminPrompts() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "prompts.add":
      try {
        return {
          handled: true,
          result: ctx.createAdminPrompt(
            (params.prompt ?? params) as Record<string, unknown>,
          ),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "prompts.update": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return {
          handled: true,
          result: ctx.updateAdminPrompt({
            id,
            patch: (params.patch ?? {}) as Record<string, unknown>,
          }),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "prompts.remove": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return { handled: true, result: { ok: ctx.deleteAdminPrompt(id) } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
case "mcp.list":
      try {
        return { handled: true, result: ctx.listAdminMcpServers() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "mcp.add":
      try {
        return {
          handled: true,
          result: ctx.createAdminMcpServer(
            (params.server ?? params) as Record<string, unknown>,
          ),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "mcp.update": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return {
          handled: true,
          result: ctx.updateAdminMcpServer({
            id,
            patch: (params.patch ?? {}) as Record<string, unknown>,
          }),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "mcp.remove": {
      const id = params.id as string;
      if (!id) {
        return { handled: true, error: "missing id parameter" };
      }
      try {
        return { handled: true, result: { ok: ctx.deleteAdminMcpServer(id) } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "providers.list":
      try {
        return {
          handled: true,
          result: await ctx.listAdminProviders({
            refresh: params.refresh === true || params.refresh === "1",
          }),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "providers.reload":
      try {
        return { handled: true, result: await ctx.reloadAdminProviders() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "capabilities.get":
      try {
        return { handled: true, result: ctx.getAdminCapabilities() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    default:
      return { handled: false };
  }
}
