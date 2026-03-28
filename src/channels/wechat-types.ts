/**
 * WeChat channel type definitions.
 * Based on @tencent-weixin/openclaw-weixin API types.
 */

// ---------------------------------------------------------------------------
// Configuration (stored in SettingsStore after QR login)
// ---------------------------------------------------------------------------

export interface WechatConfig {
  /** Bot token (issued after QR scan) */
  readonly token: string;
  /** API base URL */
  readonly baseUrl: string;
  /** Account ID (from ilink_bot_id) */
  readonly accountId: string;
}

// ---------------------------------------------------------------------------
// API types (aligned with openclaw-weixin/src/api/types.ts)
// ---------------------------------------------------------------------------

export interface TextItem { text?: string }

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: unknown;
  voice_item?: { text?: string };
  file_item?: { file_name?: string };
  video_item?: unknown;
}

export interface WechatMessage {
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  session_id?: string;
  message_id?: number;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatMessage[];
  get_updates_buf?: string;
}

export interface SendMessageReq {
  msg?: WechatMessage;
}
