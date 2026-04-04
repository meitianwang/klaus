import type { WebSocket } from "ws";
import type {
  GatewayAttemptLifecycleEvent,
  GatewaySessionRuntimeSnapshot,
} from "./session-runtime.js";
import type { GatewaySessionEvent } from "./session-events.js";

export type WsEvent =
  | {
      readonly type: "message";
      readonly text: string;
      readonly id: string;
      readonly sessionId?: string;
    }
  | {
      readonly type: "stream";
      readonly chunk: string;
      readonly sessionId?: string;
    }
  | {
      readonly type: "error";
      readonly message: string;
      readonly sessionId?: string;
    }
  | {
      readonly type: "thinking";
      readonly chunk: string;
      readonly sessionId?: string;
    }
  | { readonly type: "ping" }
  | { readonly type: "config_updated" }
  | {
      readonly type: "tool";
      readonly data: Record<string, unknown>;
      readonly sessionId?: string;
    }
  | {
      readonly type: "session_runtime";
      readonly runtime: GatewaySessionRuntimeSnapshot;
      readonly sessionId?: string;
    }
  | {
      readonly type: "session_lifecycle";
      readonly event: GatewayAttemptLifecycleEvent | string;
      readonly sessionId?: string;
    }
  | {
      readonly type: "session_event";
      readonly event: GatewaySessionEvent | Record<string, unknown>;
      readonly sessionId?: string;
    }
  | {
      readonly type: "file";
      readonly url: string;
      readonly name: string;
      readonly sessionId?: string;
    }
  | {
      readonly type: "channel_message";
      readonly sessionKey: string;
      readonly role: "user" | "assistant";
      readonly text: string;
    }
  | {
      readonly type: "context_collapse";
      readonly collapsedSpans: number;
      readonly stagedSpans: number;
      readonly totalErrors: number;
      readonly sessionId?: string;
    };

export type GatewayRpcResponseEnvelope = {
  readonly type: "rpc-response";
  readonly id: string;
  readonly result?: unknown;
  readonly error?: string;
};

export type GatewayPushClient = Pick<WebSocket, "send" | "readyState">;

const USER_ID_RE = /^[0-9a-f]{32}$/;
const SESSION_ID_RE = /^[\w:\-]{1,128}$/;

export function isValidGatewayUserId(userId: string): boolean {
  return USER_ID_RE.test(userId);
}

export function isValidGatewaySessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId);
}

export function buildWebSessionKey(userId: string, sessionId: string): string {
  return `web:${userId}:${sessionId}`;
}

export function parseWebSessionKey(
  sessionKey: string,
): { userId: string; sessionId: string } | null {
  const [channel, userId, ...rest] = sessionKey.split(":");
  if (channel !== "web" || !userId || rest.length === 0) {
    return null;
  }
  if (!isValidGatewayUserId(userId)) {
    return null;
  }
  const sessionId = rest.join(":");
  if (!isValidGatewaySessionId(sessionId)) {
    return null;
  }
  return { userId, sessionId };
}
