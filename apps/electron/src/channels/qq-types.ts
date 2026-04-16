/**
 * QQ Bot channel type definitions.
 * Based on QQ Bot Open API v2 types.
 */

// ---------------------------------------------------------------------------
// Configuration (stored in SettingsStore)
// ---------------------------------------------------------------------------

export interface QQBotConfig {
  /** QQ Bot App ID */
  readonly appId: string;
  /** QQ Bot App Secret */
  readonly clientSecret: string;
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

/** WebSocket payload */
export interface WSPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

/** C2C (private) message event */
export interface C2CMessageEvent {
  author: {
    id: string;
    union_openid: string;
    user_openid: string;
  };
  content: string;
  id: string;
  timestamp: string;
}

/** Group @bot message event */
export interface GroupMessageEvent {
  author: {
    id: string;
    member_openid: string;
    username?: string;
    bot?: boolean;
  };
  content: string;
  id: string;
  timestamp: string;
  group_id: string;
  group_openid: string;
}

/** Send message response */
export interface MessageResponse {
  id?: string;
  timestamp?: string;
}
