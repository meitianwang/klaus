/**
 * Standardized inbound message types and formatting.
 *
 * Channels produce InboundMessage objects; formatDisplayText() converts them
 * into user-facing display text.
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "location"
  | "link"
  | "file"
  | "emoji"
  | "mixed";

export interface MediaFile {
  readonly type: "image" | "audio" | "video" | "file";
  readonly path?: string;
  readonly url?: string;
  readonly fileName?: string;
  /** ASR transcription result (voice messages). */
  readonly transcription?: string;
}

export interface ReplyContext {
  readonly messageId?: string;
  /** Preview of the replied-to message. */
  readonly text?: string;
}

export interface LocationInfo {
  readonly label?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly scale?: number;
}

export interface LinkInfo {
  readonly title?: string;
  readonly description?: string;
  readonly url: string;
}

export interface InboundMessage {
  readonly sessionKey: string;
  /** Main text content (empty string when no text). */
  readonly text: string;
  readonly messageType: MessageType;
  readonly chatType: "private" | "group";
  readonly senderId: string;
  readonly senderName?: string;
  readonly media?: readonly MediaFile[];
  readonly replyTo?: ReplyContext;
  readonly mentions?: readonly string[];
  readonly location?: LocationInfo;
  readonly link?: LinkInfo;
  readonly emoji?: { readonly id?: number; readonly description?: string };
  readonly timestamp?: number;
}

// ---------------------------------------------------------------------------
// Display text: InboundMessage → user-facing text (no internal paths)
// ---------------------------------------------------------------------------

/**
 * Convert a structured InboundMessage into user-facing display text.
 * Hides internal file paths and only shows file names — safe to persist
 * in message history and show in the UI.
 */
export function formatDisplayText(msg: InboundMessage): string {
  const parts: string[] = [];

  if (msg.text) {
    parts.push(msg.text);
  }

  if (msg.media?.length) {
    for (const file of msg.media) {
      switch (file.type) {
        case "image":
          parts.push(file.fileName ? `[图片: ${file.fileName}]` : "[图片]");
          break;
        case "audio":
          parts.push(
            file.transcription
              ? `[语音: "${file.transcription}"]`
              : "[语音消息]",
          );
          break;
        case "video":
          parts.push("[视频]");
          break;
        case "file":
          parts.push(`[文件: ${file.fileName || "未知文件"}]`);
          break;
      }
    }
  }

  return parts.join("\n").trim();
}
