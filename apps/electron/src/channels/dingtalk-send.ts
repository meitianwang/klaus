/**
 * DingTalk message sending API.
 * Aligned with openclaw-china/extensions/dingtalk/src/send.ts
 *
 * Uses sampleMarkdown template for rich formatting support.
 */

import { getAccessToken } from "./dingtalk-client.js";
import type { DingtalkConfig, DingtalkSendResult } from "./dingtalk-types.js";

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const REQUEST_TIMEOUT = 30_000;

function extractTitle(text: string): string {
  const firstLine = text.split("\n")[0] || "";
  return firstLine.replace(/^[#*\s\->]+/, "").slice(0, 20) || "Klaus";
}

export async function sendTextMessage(params: {
  config: DingtalkConfig;
  to: string;
  text: string;
  chatType: "direct" | "group";
}): Promise<DingtalkSendResult> {
  const { config, to, text, chatType } = params;
  const accessToken = await getAccessToken(config.clientId, config.clientSecret);
  const title = extractTitle(text);

  if (chatType === "direct") {
    return sendDirect({ config, to, text, accessToken, title });
  }
  return sendGroup({ config, to, text, accessToken, title });
}

async function sendDirect(params: {
  config: DingtalkConfig;
  to: string;
  text: string;
  accessToken: string;
  title: string;
}): Promise<DingtalkSendResult> {
  const { config, to, text, accessToken, title } = params;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(
      `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          robotCode: config.clientId,
          userIds: [to],
          msgKey: "sampleMarkdown",
          msgParam: JSON.stringify({ title, text }),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DingTalk direct send failed: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { processQueryKey?: string };
    return { messageId: data.processQueryKey ?? `dm_${Date.now()}`, conversationId: to };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`DingTalk direct send timed out after ${REQUEST_TIMEOUT}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendGroup(params: {
  config: DingtalkConfig;
  to: string;
  text: string;
  accessToken: string;
  title: string;
}): Promise<DingtalkSendResult> {
  const { config, to, text, accessToken, title } = params;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(
      `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          robotCode: config.clientId,
          openConversationId: to,
          msgKey: "sampleMarkdown",
          msgParam: JSON.stringify({ title, text }),
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DingTalk group send failed: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { processQueryKey?: string };
    return { messageId: data.processQueryKey ?? `gm_${Date.now()}`, conversationId: to };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`DingTalk group send timed out after ${REQUEST_TIMEOUT}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Send a proactive message to any target (userId or conversationId).
 */
export async function sendMessage(params: {
  config: DingtalkConfig;
  to: string;
  text: string;
}): Promise<DingtalkSendResult> {
  // conversationId for groups typically starts with "cid" prefix
  const chatType = params.to.startsWith("cid") ? "group" : "direct";
  return sendTextMessage({ ...params, chatType });
}
