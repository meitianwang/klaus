/**
 * WeCom (企业微信) smart bot types.
 * Aligned with @wecom/aibot-node-sdk and openclaw-china/extensions/wecom.
 */

export type WecomConfig = {
  botId: string;
  secret: string;
};

/** Inbound message from WeCom WebSocket callback. */
export type WecomInboundMessage = {
  msgid?: string;
  aibotid?: string;
  chattype?: "single" | "group";
  chatid?: string;
  from?: { userid?: string; corpid?: string };
  msgtype?: string;
  text?: { content?: string };
  voice?: { content?: string };
  image?: { url?: string; media_id?: string };
  file?: { url?: string; filename?: string; media_id?: string };
  event?: { eventtype?: string; [key: string]: unknown };
};
