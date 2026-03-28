/**
 * DingTalk channel type definitions.
 * Aligned with openclaw-china/extensions/dingtalk/src/types.ts
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DingtalkConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

// ---------------------------------------------------------------------------
// Rich text elements
// ---------------------------------------------------------------------------

export interface RichTextElement {
  type: "text" | "picture" | "at";
  text?: string;
  downloadCode?: string;
  pictureDownloadCode?: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Raw message from DingTalk Stream SDK
// ---------------------------------------------------------------------------

export interface DingtalkRawMessage {
  senderId: string;
  streamMessageId?: string;
  senderStaffId?: string;
  senderNick: string;
  /** "1" = direct, "2" = group */
  conversationType: "1" | "2";
  conversationId: string;
  msgtype: string;
  text?: { content: string };
  content?: string | DingtalkMediaContent;
  atUsers?: Array<{ dingtalkId: string }>;
  robotCode?: string;
}

export interface DingtalkMediaContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  videoDownloadCode?: string;
  duration?: number;
  recognition?: string;
  fileName?: string;
  fileSize?: number;
  richText?: RichTextElement[] | string;
}

// ---------------------------------------------------------------------------
// Send result
// ---------------------------------------------------------------------------

export interface DingtalkSendResult {
  messageId: string;
  conversationId: string;
}
