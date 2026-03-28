import type { MessageStore } from "../../message-store.js";
import { buildWebSessionKey } from "../protocol.js";

/** Channel prefixes that use their own session key format (not web:{userId}:{sessionId}). */
const CHANNEL_PREFIXES = ["feishu:", "dingtalk:", "wechat:", "qq:"] as const;

function isChannelSession(sessionId: string): boolean {
  return CHANNEL_PREFIXES.some((p) => sessionId.startsWith(p));
}

export async function readGatewayHistory(params: {
  messageStore: MessageStore;
  userId: string;
  sessionId: string;
  limit: number;
}): Promise<{ messages: readonly unknown[]; total: number }> {
  // Channel sessions use their own key format, not web:{userId}:{sessionId}
  const sessionKey = isChannelSession(params.sessionId)
    ? params.sessionId
    : buildWebSessionKey(params.userId, params.sessionId);
  const all = await params.messageStore.readHistory(sessionKey);
  const messages = all.length > params.limit ? all.slice(-params.limit) : all;
  return { messages, total: all.length };
}

export async function listGatewaySessions(params: {
  messageStore: MessageStore;
  userId: string;
  /** Channel prefixes to include (e.g. ["feishu:", "dingtalk:"]). */
  includeChannels?: readonly string[];
}): Promise<{ sessions: readonly unknown[] }> {
  const webPrefix = buildWebSessionKey(params.userId, "");
  const webSessions = await params.messageStore.listSessions(webPrefix);

  // Collect sessions from each enabled channel
  const channelSessions: unknown[] = [];
  for (const prefix of params.includeChannels ?? []) {
    const raw = await params.messageStore.listSessions(prefix);
    for (const s of raw) {
      channelSessions.push({
        ...s,
        sessionId: `${prefix}${(s as { sessionId: string }).sessionId}`,
      });
    }
  }

  return { sessions: [...webSessions, ...channelSessions] };
}

export function deleteGatewaySession(params: {
  messageStore: MessageStore;
  userId: string;
  sessionId: string;
}): boolean {
  const key = isChannelSession(params.sessionId)
    ? params.sessionId
    : buildWebSessionKey(params.userId, params.sessionId);
  return params.messageStore.deleteSession(key);
}
