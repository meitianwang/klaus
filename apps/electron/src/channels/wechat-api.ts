/**
 * WeChat iLink API client.
 * Based on @tencent-weixin/openclaw-weixin/src/api/api.ts
 *
 * Provides: QR code login, long-poll getUpdates, sendMessage, sendTyping.
 */

import crypto from "node:crypto";
import type { WechatConfig, GetUpdatesResp, SendMessageReq } from "./wechat-types.js";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const CHANNEL_VERSION = "klaus-wechat-1.0";

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
}): Promise<string> {
  const base = params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`;
  const url = new URL(params.endpoint, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: buildHeaders(params.token),
      body: params.body,
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) throw new Error(`WeChat API ${params.endpoint}: HTTP ${res.status} - ${rawText}`);
    return rawText;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// QR Code Login
// ---------------------------------------------------------------------------

export async function fetchQRCode(baseUrl: string): Promise<{
  qrcode: string;
  qrcodeUrl: string;
}> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("ilink/bot/get_bot_qrcode?bot_type=3", base);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`QR code fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { qrcode: string; qrcode_img_content: string };
  return { qrcode: data.qrcode, qrcodeUrl: data.qrcode_img_content };
}

export async function pollQRStatus(baseUrl: string, qrcode: string): Promise<{
  status: "wait" | "scaned" | "confirmed" | "expired";
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
}> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LONG_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`QR status poll failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      status: "wait" | "scaned" | "confirmed" | "expired";
      bot_token?: string;
      ilink_bot_id?: string;
      baseurl?: string;
      ilink_user_id?: string;
    };
    return {
      status: data.status,
      botToken: data.bot_token,
      accountId: data.ilink_bot_id,
      baseUrl: data.baseurl,
      userId: data.ilink_user_id,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Long-poll getUpdates
// ---------------------------------------------------------------------------

export async function getUpdates(params: {
  baseUrl: string;
  token: string;
  getUpdatesBuf: string;
}): Promise<GetUpdatesResp> {
  try {
    const rawText = await apiFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.getUpdatesBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      token: params.token,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
    });
    return JSON.parse(rawText) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

export async function sendMessageWechat(params: {
  config: WechatConfig;
  to: string;
  text: string;
  contextToken?: string;
}): Promise<void> {
  const { config, to, text, contextToken } = params;
  const clientId = `klaus-wechat-${crypto.randomUUID()}`;
  const body: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: text ? [{ type: 1, text_item: { text } }] : undefined,
      context_token: contextToken,
    },
  };
  await apiFetch({
    baseUrl: config.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...body, base_info: { channel_version: CHANNEL_VERSION } }),
    token: config.token,
    timeoutMs: API_TIMEOUT_MS,
  });
}

export { DEFAULT_BASE_URL };
