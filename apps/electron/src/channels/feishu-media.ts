/**
 * Feishu media download/upload.
 * Aligned with OpenClaw's extensions/feishu/src/media.ts
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import type { FeishuConfig } from "./feishu-types.js";
import { createFeishuClient, FEISHU_MEDIA_HTTP_TIMEOUT_MS } from "./feishu-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DownloadResult = {
  buffer: Buffer;
  contentType?: string;
  fileName?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readHeaderValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" && entry.trim());
      if (typeof first === "string") return first.trim();
    }
  }
  return undefined;
}

function decodeDispositionFileName(value: string): string | undefined {
  // Try UTF-8 encoded filename first
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"(.*)"$/, "$1"));
    } catch {
      return utf8Match[1].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim();
}

function extractDownloadMetadata(response: unknown): {
  contentType?: string;
  fileName?: string;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = response as any;
  const headers = r.headers ?? r.header;

  const contentType =
    readHeaderValue(headers, "content-type") ??
    (typeof r.contentType === "string" ? r.contentType : undefined) ??
    (typeof r.mime_type === "string" ? r.mime_type : undefined) ??
    (typeof r.data?.contentType === "string" ? r.data.contentType : undefined);

  const disposition = readHeaderValue(headers, "content-disposition");
  const fileName =
    (disposition ? decodeDispositionFileName(disposition) : undefined) ??
    (typeof r.file_name === "string" ? r.file_name : undefined) ??
    (typeof r.fileName === "string" ? r.fileName : undefined) ??
    (typeof r.data?.file_name === "string" ? r.data.file_name : undefined);

  return { contentType, fileName };
}

async function readResponseBuffer(response: unknown, errorPrefix: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = response as any;

  if (r.code !== undefined && r.code !== 0) {
    throw new Error(`${errorPrefix}: ${r.msg || `code ${r.code}`}`);
  }

  if (Buffer.isBuffer(response)) return response;
  if (response instanceof ArrayBuffer) return Buffer.from(response);
  if (r.data && Buffer.isBuffer(r.data)) return r.data;
  if (r.data instanceof ArrayBuffer) return Buffer.from(r.data);

  if (typeof r.getReadableStream === "function") {
    const stream = r.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (typeof r.writeFile === "function") {
    const tmpPath = join(homedir(), ".klaus", "feishu", "tmp", `dl-${Date.now()}`);
    const tmpDir = dirname(tmpPath);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
    await r.writeFile(tmpPath);
    const buf = await readFile(tmpPath);
    try { await unlink(tmpPath); } catch { /* ignore */ }
    return buf;
  }

  if (typeof r[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of r) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (typeof r.read === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of r as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error(`${errorPrefix}: unexpected response format`);
}

// ---------------------------------------------------------------------------
// Public API: Download
// ---------------------------------------------------------------------------

/**
 * Download an image from Feishu using image_key.
 */
export async function downloadImage(params: {
  config: FeishuConfig;
  imageKey: string;
}): Promise<DownloadResult> {
  const client = createFeishuClient(params.config, { httpTimeoutMs: FEISHU_MEDIA_HTTP_TIMEOUT_MS });

  const response = await client.im.image.get({
    path: { image_key: params.imageKey },
  });

  const buffer = await readResponseBuffer(response, "Feishu image download failed");
  const meta = extractDownloadMetadata(response);
  return { buffer, contentType: meta.contentType };
}

/**
 * Download a message resource (file/image/audio/video) from Feishu.
 */
export async function downloadMessageResource(params: {
  config: FeishuConfig;
  messageId: string;
  fileKey: string;
  type: "image" | "file";
}): Promise<DownloadResult> {
  const client = createFeishuClient(params.config, { httpTimeoutMs: FEISHU_MEDIA_HTTP_TIMEOUT_MS });

  const response = await client.im.messageResource.get({
    path: { message_id: params.messageId, file_key: params.fileKey },
    params: { type: params.type },
  });

  const buffer = await readResponseBuffer(response, "Feishu resource download failed");
  return { buffer, ...extractDownloadMetadata(response) };
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\x00-\x1F\x7F\r\n"\\]/g, "_");
}

// ---------------------------------------------------------------------------
// Save media to local storage
// ---------------------------------------------------------------------------

/**
 * Save downloaded media buffer to Klaus uploads directory.
 * Returns the local file path.
 */
export async function saveMediaToLocal(params: {
  buffer: Buffer;
  fileName: string;
  senderId: string;
}): Promise<string> {
  const safeSenderId = params.senderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploadsDir = join(homedir(), ".klaus", "uploads", safeSenderId);
  if (!existsSync(uploadsDir)) {
    await mkdir(uploadsDir, { recursive: true });
  }
  const safeName = sanitizeFileName(params.fileName);
  const filePath = join(uploadsDir, `${Date.now()}-${safeName}`);
  await writeFile(filePath, params.buffer);
  return filePath;
}
