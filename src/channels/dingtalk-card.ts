/**
 * DingTalk AI Card: streaming card for typing indicator + final reply.
 * Aligned with openclaw-china/extensions/dingtalk/src/card.ts
 *
 * Flow:
 * 1. createAICard() — creates card instance + delivers to chat (user sees "thinking" state)
 * 2. finishAICard() — updates card content with AI reply + sets FINISHED state
 *
 * Uses DingTalk's built-in AI Card template (no custom template needed).
 */

import { getAccessToken } from "./dingtalk-client.js";
import type { DingtalkConfig } from "./dingtalk-types.js";

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const AI_CARD_TEMPLATE_ID = "382e4302-551d-4880-bf29-a30acfab2e71.schema";
const REQUEST_TIMEOUT = 30_000;

const AICardStatus = {
  PROCESSING: "1",
  INPUTING: "2",
  FINISHED: "3",
} as const;

interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
}

/**
 * Create and deliver an AI Card to the chat.
 * User immediately sees a "processing" card.
 */
export async function createAICard(params: {
  config: DingtalkConfig;
  conversationType: "1" | "2";
  conversationId: string;
  senderId?: string;
}): Promise<AICardInstance | null> {
  const { config, conversationType, conversationId, senderId } = params;

  try {
    const accessToken = await getAccessToken(config.clientId, config.clientSecret);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // 1. Create card instance
    const createResp = await fetchWithTimeout(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": accessToken },
      body: JSON.stringify({
        cardTemplateId: AI_CARD_TEMPLATE_ID,
        outTrackId: cardInstanceId,
        cardData: { cardParamMap: {} },
        callbackType: "STREAM",
        imGroupOpenSpaceModel: { supportForward: true },
        imRobotOpenSpaceModel: { supportForward: true },
      }),
    });
    if (!createResp.ok) {
      console.warn(`[DingTalk] AI Card create failed: HTTP ${createResp.status}`);
      return null;
    }

    // 2. Deliver card
    const isGroup = conversationType === "2";
    const deliverBody: Record<string, unknown> = {
      outTrackId: cardInstanceId,
      userIdType: 1,
    };

    if (isGroup) {
      deliverBody.openSpaceId = `dtv1.card//IM_GROUP.${conversationId}`;
      deliverBody.imGroupOpenDeliverModel = { robotCode: config.clientId };
    } else {
      if (!senderId) return null;
      deliverBody.openSpaceId = `dtv1.card//IM_ROBOT.${senderId}`;
      deliverBody.imRobotOpenDeliverModel = { spaceType: "IM_ROBOT" };
    }

    const deliverResp = await fetchWithTimeout(`${DINGTALK_API_BASE}/v1.0/card/instances/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": accessToken },
      body: JSON.stringify(deliverBody),
    });
    if (!deliverResp.ok) {
      console.warn(`[DingTalk] AI Card deliver failed: HTTP ${deliverResp.status}`);
      return null;
    }

    return { cardInstanceId, accessToken };
  } catch (err) {
    console.warn("[DingTalk] AI Card creation failed:", err);
    return null;
  }
}

/**
 * Finish the AI Card with the final reply content.
 * Card transitions: PROCESSING → INPUTING → FINISHED.
 */
export async function finishAICard(params: {
  card: AICardInstance;
  content: string;
}): Promise<void> {
  const { card, content } = params;

  try {
    // 1. Switch to INPUTING + stream final content
    await fetchWithTimeout(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": card.accessToken },
      body: JSON.stringify({
        outTrackId: card.cardInstanceId,
        cardData: {
          cardParamMap: {
            flowStatus: AICardStatus.INPUTING,
            msgContent: "",
            staticMsgContent: "",
            sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
          },
        },
      }),
    });

    // 2. Stream final content with isFinalize=true
    await fetchWithTimeout(`${DINGTALK_API_BASE}/v1.0/card/streaming`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": card.accessToken },
      body: JSON.stringify({
        outTrackId: card.cardInstanceId,
        guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        key: "msgContent",
        content,
        isFull: true,
        isFinalize: true,
        isError: false,
      }),
    });

    // 3. Set FINISHED state
    await fetchWithTimeout(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": card.accessToken },
      body: JSON.stringify({
        outTrackId: card.cardInstanceId,
        cardData: {
          cardParamMap: {
            flowStatus: AICardStatus.FINISHED,
            msgContent: content,
            staticMsgContent: "",
            sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }),
          },
        },
      }),
    });
  } catch (err) {
    console.warn("[DingTalk] AI Card finish failed:", err);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
