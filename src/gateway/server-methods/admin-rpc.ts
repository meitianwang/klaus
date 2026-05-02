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
        return { handled: true, result: await ctx.listAdminModels() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "models.add":
      try {
        return {
          handled: true,
          result: await ctx.createAdminModel(
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
          result: await ctx.updateAdminModel({
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
        return { handled: true, result: { ok: await ctx.deleteAdminModel(id) } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "prompts.list":
      try {
        return { handled: true, result: await ctx.listAdminPrompts() };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "prompts.add":
      try {
        return {
          handled: true,
          result: await ctx.createAdminPrompt(
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
          result: await ctx.updateAdminPrompt({
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
        return { handled: true, result: { ok: await ctx.deleteAdminPrompt(id) } };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    }
    case "mcp.list":
      try {
        const userId = params.userId as string;
        if (!userId) return { handled: true, error: "missing userId parameter" };
        return { handled: true, result: await ctx.listMcpServers(userId) };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "mcp.add":
      try {
        const userId = params.userId as string;
        if (!userId) return { handled: true, error: "missing userId parameter" };
        return {
          handled: true,
          result: await ctx.createMcpServer(
            userId,
            (params.server ?? params) as Record<string, unknown>,
          ),
        };
      } catch (err) {
        return { handled: true, error: String(err) };
      }
    case "mcp.remove": {
      const name = params.name as string;
      const userId = params.userId as string;
      if (!name) {
        return { handled: true, error: "missing name parameter" };
      }
      if (!userId) {
        return { handled: true, error: "missing userId parameter" };
      }
      try {
        return { handled: true, result: { ok: await ctx.deleteMcpServer(userId, name) } };
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
    default:
      return { handled: false };
  }
}
