/**
 * WeChat Work (WeCom) channel: HTTP webhook callback + API replies.
 * Uses Node.js native http and crypto modules.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createDecipheriv, createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { Channel, type Handler } from "./base.js";
import { loadWeComConfig } from "../config.js";
import type { WeComConfig } from "../types.js";

export class WeComChannel extends Channel {
  private cfg: WeComConfig;
  private aesKey: Buffer;
  private handler: Handler | null = null;
  private accessToken = "";
  private tokenExpiresAt = 0;
  private xmlParser = new XMLParser();

  constructor() {
    super();
    this.cfg = loadWeComConfig();
    this.aesKey = Buffer.from(this.cfg.encodingAesKey + "=", "base64");
  }

  // ------------------------------------------------------------------
  // Channel interface
  // ------------------------------------------------------------------

  async start(handler: Handler): Promise<void> {
    this.handler = handler;

    const server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error("[WeCom] Request error:", err);
        res.writeHead(500);
        res.end("internal error");
      });
    });

    server.listen(this.cfg.port, "0.0.0.0", () => {
      console.log(
        `Klaus WeCom channel listening on :${this.cfg.port}/callback`,
      );
    });

    // Block forever
    await new Promise(() => {});
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${this.cfg.port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    if (req.method === "GET") {
      await this.onVerify(url, res);
    } else if (req.method === "POST") {
      const body = await this.readBody(req);
      await this.onMessage(url, body, res);
    } else {
      res.writeHead(405);
      res.end("method not allowed");
    }
  }

  // ------------------------------------------------------------------
  // Callback: URL verification (GET)
  // ------------------------------------------------------------------

  private async onVerify(url: URL, res: ServerResponse): Promise<void> {
    const msgSignature = url.searchParams.get("msg_signature") ?? "";
    const timestamp = url.searchParams.get("timestamp") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const echostr = url.searchParams.get("echostr") ?? "";

    if (!this.verifySignature(msgSignature, timestamp, nonce, echostr)) {
      res.writeHead(403);
      res.end("signature mismatch");
      return;
    }

    const plaintext = this.decrypt(echostr);
    res.writeHead(200);
    res.end(plaintext);
  }

  // ------------------------------------------------------------------
  // Callback: receive message (POST)
  // ------------------------------------------------------------------

  private async onMessage(
    url: URL,
    body: string,
    res: ServerResponse,
  ): Promise<void> {
    const msgSignature = url.searchParams.get("msg_signature") ?? "";
    const timestamp = url.searchParams.get("timestamp") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";

    const parsed = this.xmlParser.parse(body);
    const root = parsed.xml;
    const encryptText = root?.Encrypt;
    if (!encryptText) {
      res.writeHead(400);
      res.end("bad request");
      return;
    }

    if (!this.verifySignature(msgSignature, timestamp, nonce, encryptText)) {
      res.writeHead(403);
      res.end("signature mismatch");
      return;
    }

    const xmlText = this.decrypt(encryptText);
    const msg = this.xmlParser.parse(xmlText).xml;

    const msgType = (msg?.MsgType ?? "").toString().trim();
    const fromUser = (msg?.FromUserName ?? "").toString().trim();
    const content = (msg?.Content ?? "").toString().trim();

    if (msgType !== "text" || !content || !fromUser) {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    // Process in background so we respond to WeCom quickly
    this.handleAndReply(fromUser, content);
    res.writeHead(200);
    res.end("ok");
  }

  private async handleAndReply(userId: string, content: string): Promise<void> {
    if (!this.handler) return;
    const sessionKey = `wecom:${userId}`;

    let reply: string | null;
    try {
      reply = await this.handler(sessionKey, content);
    } catch (err) {
      reply = `[Error] ${err}`;
    }

    if (reply === null) {
      console.log("[WeCom] Message merged into batch, skipping reply");
      return;
    }

    await this.sendText(userId, reply);
  }

  // ------------------------------------------------------------------
  // Send message via API
  // ------------------------------------------------------------------

  private async sendText(userId: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const payload = {
      touser: userId,
      agentid: this.cfg.agentId,
      msgtype: "text",
      text: { content: text },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { errcode?: number };
    if (data.errcode && data.errcode !== 0) {
      console.error(`[WeCom] send failed:`, data);
    }
  }

  // ------------------------------------------------------------------
  // Access token management
  // ------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    url.searchParams.set("corpid", this.cfg.corpId);
    url.searchParams.set("corpsecret", this.cfg.corpSecret);

    const resp = await fetch(url.toString());
    const data = (await resp.json()) as {
      errcode?: number;
      access_token?: string;
      expires_in?: number;
    };

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`Failed to get access_token: ${JSON.stringify(data)}`);
    }

    this.accessToken = data.access_token ?? "";
    // Refresh 5 minutes early
    this.tokenExpiresAt = Date.now() + ((data.expires_in ?? 7200) - 300) * 1000;
    return this.accessToken;
  }

  // ------------------------------------------------------------------
  // WeCom message encryption / signature
  // ------------------------------------------------------------------

  private verifySignature(
    signature: string,
    timestamp: string,
    nonce: string,
    encrypt: string,
  ): boolean {
    const parts = [this.cfg.token, timestamp, nonce, encrypt].sort();
    const digest = createHash("sha1").update(parts.join("")).digest("hex");
    return digest === signature;
  }

  private decrypt(encryptText: string): string {
    const iv = this.aesKey.subarray(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", this.aesKey, iv);
    decipher.setAutoPadding(false);
    let raw = Buffer.concat([
      decipher.update(Buffer.from(encryptText, "base64")),
      decipher.final(),
    ]);

    // Remove PKCS#7 padding
    const padLen = raw[raw.length - 1];
    raw = raw.subarray(0, raw.length - padLen);

    // Format: 16 bytes random + 4 bytes msg_len (big endian) + msg + corp_id
    const msgLen = raw.readUInt32BE(16);
    const msg = raw.subarray(20, 20 + msgLen);
    return msg.toString("utf-8");
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }
}
