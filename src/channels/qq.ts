/**
 * QQ Bot channel: WebSocket connection via QQ OpenAPI.
 * Uses qq-group-bot SDK if available, otherwise provides clear error.
 */

import { execSync } from "node:child_process";
import { Channel, type Handler } from "./base.js";
import { loadQQBotConfig } from "../config.js";

export class QQChannel extends Channel {
  private cfg = loadQQBotConfig();

  async start(handler: Handler): Promise<void> {
    console.log("Cpaw QQ Bot channel starting...");

    let qqBot: { createOpenAPI: Function; createWebsocket: Function };
    try {
      qqBot = await import("qq-group-bot");
    } catch {
      console.log("[QQ] qq-group-bot not found, installing...");
      try {
        execSync("npm install -g qq-group-bot", { stdio: "inherit" });
        qqBot = await import("qq-group-bot");
      } catch {
        console.error(
          "[QQ] Failed to install qq-group-bot.\n" +
            "Install manually: npm install -g qq-group-bot",
        );
        process.exit(1);
      }
    }

    const testConfig = {
      appID: this.cfg.appid,
      token: this.cfg.secret,
      intents: ["GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE"],
      sandbox: false,
    };

    const client = qqBot.createOpenAPI(testConfig);
    const ws = qqBot.createWebsocket(testConfig);

    ws.on("READY", () => {
      console.log("Cpaw QQ Bot online");
    });

    ws.on(
      "C2C_MESSAGE_CREATE",
      async (data: { msg: Record<string, unknown> }) => {
        const msg = data.msg;
        const content = ((msg.content as string) ?? "").trim();
        const userOpenId =
          msg.author && (msg.author as Record<string, string>).user_openid;
        if (!content || !userOpenId) return;

        const sessionKey = `c2c:${userOpenId}`;
        console.log(`[C2C] Received (${sessionKey}): ${content}`);

        try {
          const reply = await handler(sessionKey, content);
          if (reply === null) {
            console.log("[C2C] Message merged into batch, skipping reply");
            return;
          }
          console.log(`[C2C] Replying: ${reply.slice(0, 100)}...`);
          await client.c2cApi.postMessage(userOpenId, {
            msg_type: 0,
            msg_id: msg.id as string,
            content: reply,
          });
        } catch (err) {
          console.error(`[C2C] Error: ${err}`);
        }
      },
    );

    ws.on(
      "GROUP_AT_MESSAGE_CREATE",
      async (data: { msg: Record<string, unknown> }) => {
        const msg = data.msg;
        const content = ((msg.content as string) ?? "").trim();
        const groupOpenId = msg.group_openid as string;
        if (!content || !groupOpenId) return;

        const sessionKey = `group:${groupOpenId}`;
        console.log(`[Group] Received (${sessionKey}): ${content}`);

        try {
          const reply = await handler(sessionKey, content);
          if (reply === null) {
            console.log("[Group] Message merged into batch, skipping reply");
            return;
          }
          console.log(`[Group] Replying: ${reply.slice(0, 100)}...`);
          await client.groupApi.postMessage(groupOpenId, {
            msg_type: 0,
            msg_id: msg.id as string,
            content: reply,
          });
        } catch (err) {
          console.error(`[Group] Error: ${err}`);
        }
      },
    );

    // Block forever
    await new Promise(() => {});
  }
}
