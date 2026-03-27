import type { MessageStore } from "../../message-store.js";
import { buildWebSessionKey } from "../protocol.js";

export async function readGatewayHistory(params: {
  messageStore: MessageStore;
  userId: string;
  sessionId: string;
  limit: number;
}): Promise<{ messages: readonly unknown[]; total: number }> {
  // Feishu sessions use their own key format (feishu:xxx), not web:{userId}:{sessionId}
  const sessionKey = params.sessionId.startsWith("feishu:")
    ? params.sessionId
    : buildWebSessionKey(params.userId, params.sessionId);
  const all = await params.messageStore.readHistory(sessionKey);
  const messages = all.length > params.limit ? all.slice(-params.limit) : all;
  return { messages, total: all.length };
}

export async function listGatewaySessions(params: {
  messageStore: MessageStore;
  userId: string;
  includeAdminFlag?: boolean;
}): Promise<{ sessions: readonly unknown[]; isAdmin: boolean }> {
  const isAdmin = Boolean(params.includeAdminFlag);
  const webPrefix = buildWebSessionKey(params.userId, "");
  const webSessions = await params.messageStore.listSessions(webPrefix);

  // Feishu sessions are scoped to the user who configured the channel
  const feishuPrefix = `feishu:${params.userId}:`;
  const rawFeishuSessions = await params.messageStore.listSessions(feishuPrefix);
  const feishuSessions = rawFeishuSessions.map((s) => ({
    ...s,
    sessionId: `feishu:${params.userId}:${(s as { sessionId: string }).sessionId}`,
  }));

  const sessions = [...webSessions, ...feishuSessions];
  return { sessions, isAdmin };
}

export function deleteGatewaySession(params: {
  messageStore: MessageStore;
  userId: string;
  sessionId: string;
}): boolean {
  return params.messageStore.deleteSession(
    buildWebSessionKey(params.userId, params.sessionId),
  );
}
