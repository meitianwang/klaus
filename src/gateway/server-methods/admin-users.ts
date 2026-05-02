import type { MessageStore } from "../../message-store.js";
import type { UserStore } from "../../user-store.js";
import { GatewayError } from "../errors.js";
import { buildWebSessionKey } from "../protocol.js";

export async function listGatewayAdminUsers(params: {
  userStore: UserStore;
  messageStore: MessageStore | null;
}): Promise<{ users: readonly unknown[] }> {
  const users = await params.userStore.listUsers();
  const enriched = await Promise.all(
    users.map(async (user) => {
      let sessionCount = 0;
      let totalMessages = 0;
      if (params.messageStore) {
        const sessions = await params.messageStore.listSessions(
          buildWebSessionKey(user.id, ""),
        );
        sessionCount = sessions.length;
        totalMessages = sessions.reduce(
          (sum, session) => sum + session.messageCount,
          0,
        );
      }
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        inviteCode: user.inviteCode,
        sessionCount,
        totalMessages,
      };
    }),
  );
  return { users: enriched };
}

export async function updateGatewayAdminUser(params: {
  userStore: UserStore;
  userId: string;
  isActive?: boolean;
  role?: "admin" | "user";
}): Promise<{ user: unknown }> {
  if (!params.userId) {
    throw GatewayError.badRequest("missing userId");
  }
  if (typeof params.isActive === "boolean") {
    await params.userStore.setActive(params.userId, params.isActive);
  }
  if (params.role === "admin" || params.role === "user") {
    await params.userStore.setRole(params.userId, params.role);
  }
  const user = await params.userStore.getUserById(params.userId);
  if (!user) {
    throw GatewayError.notFound("user not found");
  }
  return { user };
}

export async function listGatewayAdminSessions(params: {
  messageStore: MessageStore;
  userId: string;
}): Promise<{ sessions: readonly unknown[] }> {
  const sessions = await params.messageStore.listSessions(buildWebSessionKey(params.userId, ""));
  return { sessions };
}

export async function readGatewayAdminHistory(params: {
  messageStore: MessageStore;
  userId: string;
  sessionId: string;
}): Promise<{ messages: readonly unknown[] }> {
  const messages = await params.messageStore.readHistory(
    buildWebSessionKey(params.userId, params.sessionId),
  );
  return { messages };
}
