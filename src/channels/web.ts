/**
 * Web channel — browser-based chat UI with WebSocket for real-time bidirectional communication.
 *
 * Auth: user-based — email+password or Google OAuth, with invite code required for registration.
 *
 * Routes:
 *   GET  /                    → Chat UI HTML (requires login)
 *   GET  /login               → Login/Register page
 *   GET  /admin               → Admin panel (admin role only)
 *   WS   /api/ws              → WebSocket connection (cookie auth)
 *   POST /api/auth/register   → Register with invite code
 *   POST /api/auth/login      → Login with email+password
 *   POST /api/auth/logout     → Logout
 *   GET  /api/auth/me         → Current user info
 *   GET  /api/auth/google     → Google OAuth redirect
 *   GET  /api/auth/google/callback → Google OAuth callback
 *   POST /api/upload          → File upload
 *   GET  /api/history         → Session message history
 *   GET  /api/sessions        → List sessions
 *   DELETE /api/sessions      → Delete session
 *   GET/POST/DELETE /api/admin/invites → Invite code management (admin only)
 *   GET  /api/admin/users     → User management (admin only)
 *   PATCH /api/admin/users    → Update user (admin only)
 *   GET  /api/admin/sessions  → Browse any user's sessions (admin only)
 *   GET  /api/admin/history   → View any session's history (admin only)
 *   GET/PATCH /api/admin/settings → All settings: general, web, session, transcripts, cron (admin only)
 *   GET/POST/PATCH/DELETE /api/admin/cron/tasks → Cron task CRUD (admin only)
 *   GET  /api/health          → Health check (no auth)
 */

import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdirSync, rmSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { encryptCred, decryptCred } from "./channel-creds.js";
import type { ChannelPlugin, ChannelGatewayContext } from "./types.js";
import type { Handler } from "../types.js";
import type { WebConfig } from "../types.js";
import {
  loadWebConfig,
  loadConfig,
  CONFIG_FILE,
  CONFIG_DIR,
} from "../config.js";
import { getUserUploadsDir } from "../user-dirs.js";
import type {
  CronTask,
  CronTaskStatus,
  CronSchedulerStatus,
} from "../types.js";
import type { InboundMessage, MediaFile } from "../message.js";
import { getChatHtml } from "./web-ui.js";
import { getAdminHtml } from "./web-admin-ui.js";
import { getLoginHtml } from "./web-login-ui.js";
import type { MessageStore } from "../message-store.js";
import type { InviteStore } from "../invite-store.js";
import type { UserStore, User } from "../user-store.js";
import {
  getSessionToken,
  handleAuthRegister,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthProfile,
  handleAvatarUpload,
  handleAvatarServe,
  handleGoogleRedirect,
  handleGoogleCallback,
} from "./web-auth.js";
import { validateLocalToken } from "../local-token.js";
import {
  getGatewayService,
} from "../gateway/service.js";
import {
  isValidGatewaySessionId,
  isValidGatewayUserId,
  type GatewayRpcResponseEnvelope,
  type WsEvent,
} from "../gateway/protocol.js";
import { gatewayErrorStatusCode } from "../gateway/errors.js";

// ---------------------------------------------------------------------------
// File upload storage
// ---------------------------------------------------------------------------

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// File download token registry
// ---------------------------------------------------------------------------

interface DownloadEntry {
  readonly path: string;
  readonly name: string;
  readonly userId: string;
  readonly expiresAt: number;
}

const downloadTokens = new Map<string, DownloadEntry>();
const DOWNLOAD_TOKEN_TTL_MS = 30 * 60_000; // 30 minutes

// Cleanup expired download tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of downloadTokens) {
    if (now >= entry.expiresAt) downloadTokens.delete(token);
  }
}, 5 * 60_000);

/** Allowed directory prefixes for downloadable files. */
const DOWNLOAD_ALLOWED_DIRS = ["/tmp", tmpdir()];

function registerDownloadToken(
  filePath: string,
  userId: string,
): { token: string; name: string } {
  // Resolve to absolute path and block path traversal
  const resolved = resolve(filePath);
  const userUploadDir = getUserUploadsDir(userId);
  const allowed =
    DOWNLOAD_ALLOWED_DIRS.some(
      (dir) => resolved === dir || resolved.startsWith(dir + "/"),
    ) ||
    resolved === userUploadDir ||
    resolved.startsWith(userUploadDir + "/");
  if (!allowed) {
    throw new Error(
      `Download path not allowed: ${resolved} (must be under /tmp or user uploads)`,
    );
  }

  const token = randomBytes(16).toString("hex");
  const name = resolved.split("/").pop() ?? "file";
  downloadTokens.set(token, {
    path: resolved,
    name,
    userId,
    expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
  });
  return { token, name };
}

const ALLOWED_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "text/",
  "application/pdf",
  "application/json",
  "application/zip",
  "application/gzip",
  "application/xml",
  // MS Office
  "application/msword",
  "application/vnd.ms-",
  "application/vnd.openxmlformats-officedocument.",
  // OpenDocument
  "application/vnd.oasis.opendocument.",
  // Other common docs
  "application/rtf",
  "application/x-yaml",
] as const;

// Fallback: allow upload when MIME is generic but extension is known-safe
const ALLOWED_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "pdf",
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "log",
  "html",
  "js",
  "ts",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "sh",
  "bat",
  "zip",
  "gz",
  "tar",
]);

// ---------------------------------------------------------------------------
// Store references (set by index.ts)
// ---------------------------------------------------------------------------

let messageStoreRef: MessageStore | null = null;
let inviteStoreRef: InviteStore | null = null;
let userStoreRef: UserStore | null = null;
let settingsStoreRef: import("../settings-store.js").SettingsStore | null = null;
const gateway = getGatewayService();

function setMessageStore(store: MessageStore): void {
  messageStoreRef = store;
  gateway.setMessageStore(store);
}

function setInviteStore(store: InviteStore): void {
  inviteStoreRef = store;
}

function setUserStore(store: UserStore): void {
  userStoreRef = store;
  gateway.setUserStore(store);
}

function setSettingsStore(store: import("../settings-store.js").SettingsStore): void {
  settingsStoreRef = store;
  gateway.setSettingsStore(store);
}

// Cron scheduler reference (optional — set from index.ts when cron is available)
let cronSchedulerRef: {
  getStatus(): readonly CronTaskStatus[];
  getSchedulerStatus(): CronSchedulerStatus;
  addTask(task: CronTask): void;
  editTask(id: string, patch: Partial<CronTask>): boolean;
  removeTask(id: string): boolean;
  runTask(id: string): Promise<unknown>;
} | null = null;

let handlerRef: import("../types.js").Handler | null = null;

function setHandler(handler: import("../types.js").Handler): void {
  handlerRef = handler;
}

function setCronScheduler(scheduler: typeof cronSchedulerRef): void {
  cronSchedulerRef = scheduler;
  gateway.setCronScheduler(scheduler);
}

// Memory manager reference (optional — set from index.ts when memory is enabled)
let memoryPoolRef: import("../memory/pool.js").MemoryManagerPool | null = null;

function setMemoryPool(pool: import("../memory/pool.js").MemoryManagerPool): void {
  memoryPoolRef = pool;
}

// Agent manager reference (for direct tool invocation API)
let agentManagerRef: import("../agent-manager.js").AgentSessionManager | null = null;

function setAgentManager(manager: import("../agent-manager.js").AgentSessionManager): void {
  agentManagerRef = manager;
}

// ---------------------------------------------------------------------------
// Hot-start: delegate to ChannelManager for proper lifecycle management
// ---------------------------------------------------------------------------

let channelManagerRef: import("./manager.js").ChannelManager | null = null;

function hotStartChannel(channelId: string): void {
  if (!channelManagerRef) {
    console.warn(`[Web] Cannot hot-start "${channelId}": ChannelManager not available`);
    return;
  }
  channelManagerRef.hotStart(channelId);
}

// ---------------------------------------------------------------------------
// WebSocket client management (keyed by userId instead of token)
// ---------------------------------------------------------------------------

interface KlausWebSocket extends WebSocket {
  isAlive: boolean;
  klausUserId: string;
  klausIp: string;
}

function sendWsEvent(userId: string, event: WsEvent): void {
  gateway.sendEvent(userId, event);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

type AuthResult =
  | { readonly kind: "admin"; readonly user: User }
  | { readonly kind: "user"; readonly user: User }
  | { readonly kind: "invalid" };

function authenticateRequest(req: IncomingMessage): AuthResult {
  if (!userStoreRef) return { kind: "invalid" };
  const token = getSessionToken(req);
  const auth = userStoreRef.validateSession(token);
  if (!auth) return { kind: "invalid" };
  return {
    kind: auth.user.role === "admin" ? "admin" : "user",
    user: auth.user,
  };
}

// Short label for logging
function userLabel(user: User): string {
  return `${user.email.split("@")[0]}(${user.id.slice(0, 6)})`;
}

// ---------------------------------------------------------------------------
// Rate limiting (per-IP, simple sliding window)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired rate limit buckets every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, 2 * 60_000);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX_REQUESTS;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(
  req: IncomingMessage,
  maxSize?: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const limit = maxSize ?? 1024 * 64;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(
  req: IncomingMessage,
  maxSize: number,
): Promise<Record<string, unknown>> {
  const body = await readBody(req, maxSize);
  try {
    return JSON.parse(body.toString()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid JSON");
  }
}

function gatewayErrorResponse(
  res: ServerResponse,
  err: unknown,
): void {
  jsonResponse(res, gatewayErrorStatusCode(err), {
    error: err instanceof Error ? err.message : String(err),
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' fonts.googleapis.com cdn.jsdelivr.net 'unsafe-inline'; font-src fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-src 'self';",
};

function serveHtmlPage(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    ...SECURITY_HEADERS,
  });
  res.end(html);
}

async function servePublicFile(
  res: ServerResponse,
  filename: string,
  contentType: string,
): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const candidates = [
    join(__dirname, "..", "public", filename),
    join(__dirname, "..", "..", "public", filename),
    join(process.cwd(), "public", filename),
  ];
  for (const p of candidates) {
    try {
      const data = readFileSync(p);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      });
      res.end(data);
      return;
    } catch {
      // try next
    }
  }
  res.writeHead(404);
  res.end("not found");
}

function getClientIp(req: IncomingMessage): string {
  // Only use socket address for rate limiting — X-Forwarded-For is client-spoofable
  return req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function serveHtml(req: IncomingMessage, res: ServerResponse): void {
  const auth = authenticateRequest(req);
  if (auth.kind === "invalid") {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }
  serveHtmlPage(res, getChatHtml());
}

function serveLogin(res: ServerResponse, cfg: WebConfig): void {
  const isFirst = userStoreRef ? userStoreRef.isFirstUser() : false;
  serveHtmlPage(res, getLoginHtml(!!cfg.google, isFirst));
}

function serveAdmin(req: IncomingMessage, res: ServerResponse): void {
  const auth = authenticateRequest(req);
  if (auth.kind !== "admin") {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }
  // Admin panel is only served as an iframe inside the chat UI.
  // Direct access to /admin redirects to chat page (which opens admin view).
  const url = new URL(req.url ?? "", "http://localhost");
  if (url.searchParams.get("embed") !== "1") {
    res.writeHead(302, { Location: "/#admin" });
    res.end();
    return;
  }
  serveHtmlPage(res, getAdminHtml());
}


// ---------------------------------------------------------------------------
// Message processing (shared by WebSocket handler)
// ---------------------------------------------------------------------------

async function processUserMessage(
  userId: string,
  text: string,
  fileIds: string[],
  sessionId: string,
  handler: Handler,
  cfg: WebConfig,
): Promise<void> {
  // Build media list from uploaded file IDs
  const media: MediaFile[] = [];
  for (const fileId of fileIds) {
    const meta = uploadedFiles.get(fileId);
    if (!meta) continue;
    media.push({
      type: meta.mediaType,
      path: meta.path,
      fileName: meta.originalName,
    });
    uploadedFiles.delete(fileId);
  }
  try {
    await gateway.processInboundMessage({
      userId,
      text,
      sessionId,
      media,
      handler,
    });
  } catch (err) {
    console.error("[Web] Handler error:", err);
    sendWsEvent(userId, {
      type: "error",
      message: "An internal error occurred. Please try again.",
      sessionId,
    });
  }
}

// ---------------------------------------------------------------------------
// WebSocket message handler
// ---------------------------------------------------------------------------

type ClientWsMessage =
  | { type: "message"; text?: string; sessionId?: string; files?: string[] }
  | {
      type: "rpc";
      id: string;
      method: string;
      params?: Record<string, unknown>;
    }
  | { type: "pong" };

function handleWsMessage(
  ws: KlausWebSocket,
  raw: RawData,
  handler: Handler,
  cfg: WebConfig,
): void {
  let parsed: ClientWsMessage;
  try {
    parsed = JSON.parse(raw.toString()) as ClientWsMessage;
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
    return;
  }

  const userId = ws.klausUserId;
  const ip = ws.klausIp;

  switch (parsed.type) {
    case "message": {
      if (!checkRateLimit(ip)) {
        ws.send(
          JSON.stringify({ type: "error", message: "too many requests" }),
        );
        return;
      }
      processUserMessage(
        userId,
        parsed.text ?? "",
        parsed.files ?? [],
        parsed.sessionId ?? "default",
        handler,
        cfg,
      ).catch((err) => {
        console.error("[Web] processUserMessage error:", err);
      });
      break;
    }
    case "pong":
      break;
    case "rpc": {
      if (
        (parsed.method === "chat.send" || parsed.method === "voice.send") &&
        !checkRateLimit(ip)
      ) {
        ws.send(
          JSON.stringify({
            type: "rpc-response",
            id: parsed.id,
            error: "too many requests",
          }),
        );
        break;
      }
      handleRpcRequest(
        ws,
        parsed.id,
        parsed.method,
        parsed.params ?? {},
        handler,
      ).catch((err) => {
        console.error("[Web] RPC error:", err);
        ws.send(
          JSON.stringify({
            type: "rpc-response",
            id: parsed.id,
            error: String(err),
          }),
        );
      });
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC handler (for macOS app and programmatic clients)
// ---------------------------------------------------------------------------

async function handleRpcRequest(
  ws: KlausWebSocket,
  id: string,
  method: string,
  params: Record<string, unknown>,
  handler: Handler,
): Promise<void> {
  const response: GatewayRpcResponseEnvelope = await gateway.handleRpcRequest({
    id,
    method,
    params,
    userId: ws.klausUserId,
    handler,
  });
  ws.send(JSON.stringify(response));
}

// ---------------------------------------------------------------------------
// File upload handler
// ---------------------------------------------------------------------------

interface UploadMeta {
  readonly path: string;
  readonly originalName: string;
  readonly mediaType: "image" | "audio" | "video" | "file";
  readonly createdAt: number;
}

const uploadedFiles = new Map<string, UploadMeta>();

// Cleanup stale upload metadata every 10 minutes (entries older than 30 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, meta] of uploadedFiles) {
    if (meta.createdAt < cutoff) uploadedFiles.delete(id);
  }
}, 10 * 60_000);

function inferMediaType(
  contentType: string,
  fileName: string,
): "image" | "audio" | "video" | "file" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext))
    return "image";
  if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "avi"].includes(ext)) return "video";
  return "file";
}

async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    jsonResponse(res, 429, { error: "too many requests" });
    return;
  }

  const auth = authenticateRequest(req);
  if (auth.kind === "invalid") {
    jsonResponse(res, 401, { error: "unauthorized" });
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const contentType = req.headers["content-type"] ?? "";
  const fileName = decodeURIComponent(url.searchParams.get("name") ?? "upload");

  if (!contentType) {
    jsonResponse(res, 400, { error: "missing content-type" });
    return;
  }

  // Validate MIME type against whitelist
  const mimeAllowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
    contentType.startsWith(prefix),
  );
  // Fallback: if MIME is generic/unknown, check file extension
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!mimeAllowed && !ALLOWED_EXTENSIONS.has(ext)) {
    jsonResponse(res, 415, { error: "unsupported media type" });
    return;
  }

  const data = await readBody(req, MAX_UPLOAD_SIZE);

  // Sanitize file name: basename only, strip unsafe chars
  const baseName = fileName.split(/[\\/]/).pop() ?? "upload";
  const safeBase = baseName.replace(/[^\w.\-]/g, "_");
  const diskName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safeBase}`;

  // Store uploads in user's uploads/ subdirectory
  const userUploadDir = getUserUploadsDir(auth.user.id);
  mkdirSync(userUploadDir, { recursive: true });
  const filePath = join(userUploadDir, diskName);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, data);

  const fileId = randomBytes(16).toString("hex");
  const mediaType = inferMediaType(contentType, baseName);

  uploadedFiles.set(fileId, {
    path: filePath,
    originalName: baseName,
    mediaType,
    createdAt: Date.now(),
  });

  console.log(
    `[Web] Upload (${userLabel(auth.user)}): ${fileName} → ${mediaType} [${data.length} bytes]`,
  );

  jsonResponse(res, 200, { id: fileId, type: mediaType, name: fileName });
}

// ---------------------------------------------------------------------------
// Admin: shared auth guard (cookie-based, checks role)
// ---------------------------------------------------------------------------

function adminAuth(req: IncomingMessage, res: ServerResponse): User | null {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    jsonResponse(res, 429, { error: "too many requests" });
    return null;
  }
  const auth = authenticateRequest(req);
  if (auth.kind !== "admin") {
    jsonResponse(res, 401, { error: "admin access required" });
    return null;
  }
  return auth.user;
}

// ---------------------------------------------------------------------------
// Admin: invite code CRUD
// ---------------------------------------------------------------------------

async function handleAdminInvites(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  if (!inviteStoreRef) {
    jsonResponse(res, 503, { error: "invite store unavailable" });
    return;
  }

  if (req.method === "GET") {
    const invites = inviteStoreRef.list();
    jsonResponse(res, 200, { invites });
    return;
  }

  if (req.method === "POST") {
    const body = await readBody(req, 1024);
    let label = "";
    try {
      const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
      label =
        typeof parsed.label === "string" ? parsed.label.slice(0, 100) : "";
    } catch {
      // Empty label is fine
    }
    const invite = inviteStoreRef.create(label);
    console.log(
      `[Web] Created invite code: ${invite.code.slice(0, 8)}... (label: ${label || "(none)"})`,
    );
    jsonResponse(res, 201, { invite });
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "/", "http://localhost");
    const code = url.searchParams.get("code") ?? "";
    if (!code) {
      jsonResponse(res, 400, { error: "missing code parameter" });
      return;
    }
    const deleted = inviteStoreRef.delete(code);
    if (!deleted) {
      jsonResponse(res, 404, { error: "invite code not found" });
      return;
    }
    console.log(`[Web] Deleted invite code: ${code.slice(0, 8)}...`);
    jsonResponse(res, 200, { deleted: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: user management
// ---------------------------------------------------------------------------

async function handleAdminUsers(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, await gateway.listAdminUsers());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const parsed = await readJsonBody(req, 1024);
      jsonResponse(
        res,
        200,
        gateway.updateAdminUser({
          userId: String(parsed.userId ?? ""),
          isActive:
            typeof parsed.isActive === "boolean" ? parsed.isActive : undefined,
          role:
            parsed.role === "admin" || parsed.role === "user"
              ? parsed.role
              : undefined,
        }),
      );
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: browse sessions for any user
// ---------------------------------------------------------------------------

async function handleAdminSessions(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const userId = url.searchParams.get("userId") ?? "";
  if (!userId || !isValidGatewayUserId(userId)) {
    jsonResponse(res, 400, { error: "missing or invalid userId" });
    return;
  }

  try {
    jsonResponse(res, 200, await gateway.listAdminSessions({ userId }));
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Admin: read conversation history for any session
// ---------------------------------------------------------------------------

async function handleAdminHistory(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const userId = url.searchParams.get("userId") ?? "";
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!userId || !isValidGatewayUserId(userId)) {
    jsonResponse(res, 400, { error: "missing or invalid userId" });
    return;
  }
  if (!sessionId || !isValidGatewaySessionId(sessionId)) {
    jsonResponse(res, 400, { error: "missing or invalid sessionId" });
    return;
  }

  try {
    jsonResponse(res, 200, await gateway.readAdminHistory({ userId, sessionId }));
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Admin: settings (KV store)
// ---------------------------------------------------------------------------

async function handleAdminSettings(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.getAdminSettings());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const parsed = await readJsonBody(req, 8192);
      jsonResponse(res, 200, gateway.updateAdminSettings(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: cron tasks CRUD
// ---------------------------------------------------------------------------

async function handleAdminCronTasks(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.listCronTasks());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 201, gateway.createCronTask(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) {
      jsonResponse(res, 400, { error: "id query parameter required" });
      return;
    }

    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 200, gateway.updateCronTask({ id, patch: parsed }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) {
      jsonResponse(res, 400, { error: "id query parameter required" });
      return;
    }

    try {
      const deleted = gateway.deleteCronTask(id);
      if (!deleted) {
        jsonResponse(res, 404, { error: "task not found" });
        return;
      }
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: providers (read-only, from registry)
// ---------------------------------------------------------------------------

async function handleAdminProviders(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(req.url ?? "", "http://localhost");
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    jsonResponse(res, 200, await gateway.listAdminProviders({ refresh }));
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Admin: providers reload (hot reload external providers)
// ---------------------------------------------------------------------------

async function handleAdminProvidersReload(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  try {
    jsonResponse(res, 200, await gateway.reloadAdminProviders());
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Admin: capabilities (read-only)
// ---------------------------------------------------------------------------

function handleAdminCapabilities(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!adminAuth(req, res)) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  try {
    jsonResponse(res, 200, gateway.getAdminCapabilities());
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// OAuth: provider authorization flow
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function serveOAuthResultPage(
  res: ServerResponse,
  params: {
    title: string;
    message?: string;
    markCompleted?: boolean;
  },
): void {
  const script = params.markCompleted
    ? `<script>localStorage.setItem("klaus_oauth_done","1");window.close()</script>`
    : "<script>window.close()</script>";
  const message = params.message ? `<p>${escHtml(params.message)}</p>` : "";
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    `<html><body><h2>${escHtml(params.title)}</h2>${message}${script}</body></html>`,
  );
}

async function handleOAuthStart(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: WebConfig,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  const url = new URL(req.url ?? "", "http://localhost");
  const providerId = url.searchParams.get("provider") ?? "";
  const modelId = url.searchParams.get("modelId") ?? "";
  try {
    const result = gateway.beginProviderOAuth({
      providerId,
      modelId,
      host: req.headers.host,
      protocol: String(req.headers["x-forwarded-proto"] ?? "http"),
      defaultPort: cfg.port,
    });
    res.writeHead(302, { Location: result.redirectTo });
    res.end();
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");
  const result = await gateway.completeProviderOAuth({ code, state, error });
  serveOAuthResultPage(res, result);
}

// ---------------------------------------------------------------------------
// Admin: models CRUD
// ---------------------------------------------------------------------------

async function handleAdminModels(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.listAdminModels());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 201, gateway.createAdminModel(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }

    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 200, gateway.updateAdminModel({ id, patch: parsed }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }
    try {
      const deleted = gateway.deleteAdminModel(id);
      if (!deleted) { jsonResponse(res, 404, { error: "model not found" }); return; }
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: prompts CRUD
// ---------------------------------------------------------------------------

async function handleAdminPrompts(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.listAdminPrompts());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 16384);
      jsonResponse(res, 201, gateway.createAdminPrompt(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }

    try {
      const parsed = await readJsonBody(req, 16384);
      jsonResponse(res, 200, gateway.updateAdminPrompt({ id, patch: parsed }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }
    try {
      const deleted = gateway.deleteAdminPrompt(id);
      if (!deleted) { jsonResponse(res, 404, { error: "prompt not found" }); return; }
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: rules CRUD
// ---------------------------------------------------------------------------

async function handleAdminRules(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.listAdminRules());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 16384);
      jsonResponse(res, 201, gateway.createAdminRule(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }

    try {
      const parsed = await readJsonBody(req, 16384);
      jsonResponse(res, 200, gateway.updateAdminRule({ id, patch: parsed }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }
    try {
      const deleted = gateway.deleteAdminRule(id);
      if (!deleted) { jsonResponse(res, 404, { error: "rule not found" }); return; }
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: MCP servers CRUD
// ---------------------------------------------------------------------------

async function handleAdminMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;
  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, gateway.listAdminMcpServers());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 201, gateway.createAdminMcpServer(parsed));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }

    try {
      const parsed = await readJsonBody(req, 4096);
      jsonResponse(res, 200, gateway.updateAdminMcpServer({ id, patch: parsed }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id") ?? "";
    if (!id) { jsonResponse(res, 400, { error: "id required" }); return; }
    try {
      const deleted = gateway.deleteAdminMcpServer(id);
      if (!deleted) { jsonResponse(res, 404, { error: "server not found" }); return; }
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: Skills management
// ---------------------------------------------------------------------------

async function handleAdminSkills(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      jsonResponse(res, 200, await gateway.listAdminSkills());
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) { jsonResponse(res, 400, { error: "name required" }); return; }
      jsonResponse(res, 200, gateway.updateAdminSkill({ name, enabled: Boolean(parsed.enabled) }));
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

async function handleAdminSkillsInstall(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const spec = parsed.spec as Record<string, unknown> | undefined;
      if (!spec || typeof spec !== "object") {
        jsonResponse(res, 400, { error: "spec required" });
        return;
      }
      const ALLOWED_KINDS = ["brew", "npm", "go", "uv"];
      if (!ALLOWED_KINDS.includes(String(spec.kind ?? ""))) {
        jsonResponse(res, 400, { error: `invalid install kind: "${String(spec.kind)}"` });
        return;
      }
      const result = await gateway.installAdminSkillDep({
        spec: spec as unknown as import("../skills/installer.js").InstallSpec,
        timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
      });
      jsonResponse(res, result.ok ? 200 : 500, { ...result });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: channel configuration (Feishu etc.)
// ---------------------------------------------------------------------------

async function handleAdminChannels(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!adminAuth(req, res)) return;

  // GET /api/admin/channels — list all channel configs
  if (req.method === "GET") {
    if (!settingsStoreRef) {
      jsonResponse(res, 503, { error: "settings store unavailable" });
      return;
    }
    const feishuAppId = settingsStoreRef.get("channel.feishu.app_id") ?? "";
    const feishuEnabled = settingsStoreRef.getBool("channel.feishu.enabled", false);
    const feishuBotName = settingsStoreRef.get("channel.feishu.bot_name") ?? "";
    const dtClientId = settingsStoreRef.get("channel.dingtalk.client_id") ?? "";
    const dtEnabled = settingsStoreRef.getBool("channel.dingtalk.enabled", false);
    const wxAccountId = settingsStoreRef.get("channel.wechat.account_id") ?? "";
    const wxEnabled = settingsStoreRef.getBool("channel.wechat.enabled", false);
    const qqAppId = settingsStoreRef.get("channel.qq.app_id") ?? "";
    const qqEnabled = settingsStoreRef.getBool("channel.qq.enabled", false);
    jsonResponse(res, 200, {
      feishu: {
        enabled: feishuEnabled && !!feishuAppId,
        app_id: feishuAppId,
        bot_name: feishuBotName,
      },
      dingtalk: {
        enabled: dtEnabled && !!dtClientId,
        client_id: dtClientId,
      },
      wechat: {
        enabled: wxEnabled && !!wxAccountId,
        account_id: wxAccountId,
      },
      qq: {
        enabled: qqEnabled && !!qqAppId,
        app_id: qqAppId,
      },
      wecom: {
        enabled: settingsStoreRef.getBool("channel.wecom.enabled", false) && !!(settingsStoreRef.get("channel.wecom.bot_id") ?? ""),
        bot_id: settingsStoreRef.get("channel.wecom.bot_id") ?? "",
      },
    });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

async function handleAdminChannelFeishu(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const authUser = adminAuth(req, res);
  if (!authUser) return;

  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  // POST /api/admin/channels/feishu — validate credentials and connect
  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const appId = String(parsed.app_id ?? "").trim();
      const appSecret = String(parsed.app_secret ?? "").trim();
      if (!appId || !appSecret) {
        jsonResponse(res, 400, { error: "app_id and app_secret are required" });
        return;
      }

      // Validate credentials by probing bot identity
      const { probeBotIdentity } = await import("./feishu-client.js");
      const identity = await probeBotIdentity({ appId, appSecret }, 10_000);
      if (!identity.botOpenId) {
        jsonResponse(res, 400, {
          ok: false,
          error: "Failed to connect. Check App ID, App Secret, and that the app has Bot capability enabled.",
        });
        return;
      }

      // Save to SettingsStore (including owner for user-level isolation)
      settingsStoreRef.set("channel.feishu.app_id", appId);
      settingsStoreRef.set("channel.feishu.app_secret", encryptCred(appSecret));
      settingsStoreRef.set("channel.feishu.enabled", "true");
      settingsStoreRef.set("channel.feishu.bot_name", identity.botName ?? "");
      settingsStoreRef.set("channel.feishu.bot_open_id", identity.botOpenId);
      settingsStoreRef.set("channel.feishu.owner_id", authUser.id);

      hotStartChannel("feishu");

      jsonResponse(res, 200, {
        ok: true,
        app_id: appId,
        bot_name: identity.botName ?? "",
        bot_open_id: identity.botOpenId,
        enabled: true,
      });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  // DELETE /api/admin/channels/feishu — disconnect
  if (req.method === "DELETE") {
    settingsStoreRef.set("channel.feishu.enabled", "false");
    settingsStoreRef.set("channel.feishu.app_id", "");
    settingsStoreRef.set("channel.feishu.app_secret", "");
    settingsStoreRef.set("channel.feishu.bot_name", "");
    settingsStoreRef.set("channel.feishu.bot_open_id", "");
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Memory admin handlers
// ---------------------------------------------------------------------------

async function handleAdminMemory(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = adminAuth(req, res);
  if (!user) return;
  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  if (req.method === "GET") {
    const config = settingsStoreRef.getMemoryConfig();
    const adminMgr = memoryPoolRef ? await memoryPoolRef.getOrCreate(user.id) : null;
    const status = adminMgr?.status() ?? null;
    jsonResponse(res, 200, { config, status });
    return;
  }

  if (req.method === "PATCH") {
    try {
      const body = await readJsonBody(req, 8192);
      const fields: Record<string, string> = {
        "memory.enabled": "enabled",
        "memory.provider": "provider",
        "memory.fallback": "fallback",
        "memory.model": "model",
        "memory.citations": "citations",
        "memory.sources": "sources",
        "memory.chunk_tokens": "chunk_tokens",
        "memory.chunk_overlap": "chunk_overlap",
        "memory.max_results": "max_results",
        "memory.min_score": "min_score",
        "memory.hybrid_enabled": "hybrid_enabled",
        "memory.hybrid_vector_weight": "hybrid_vector_weight",
        "memory.hybrid_text_weight": "hybrid_text_weight",
        "memory.sync_interval_minutes": "sync_interval_minutes",
      };
      const b = body as Record<string, unknown>;
      for (const [storeKey, bodyKey] of Object.entries(fields)) {
        const value = b[bodyKey];
        if (value !== undefined) {
          if (bodyKey === "sources" && Array.isArray(value)) {
            settingsStoreRef.set(storeKey, JSON.stringify(value));
          } else {
            settingsStoreRef.set(storeKey, String(value));
          }
        }
      }
      // Per-provider API keys and base URLs (whitelist provider IDs)
      const VALID_PROVIDER_IDS = new Set(["openai", "local", "gemini", "voyage", "mistral", "ollama"]);
      const providersCfg = b.providers as Record<string, Record<string, string>> | undefined;
      if (providersCfg && typeof providersCfg === "object") {
        for (const [pid, cfg] of Object.entries(providersCfg)) {
          if (!VALID_PROVIDER_IDS.has(pid)) continue;
          if (cfg.api_key !== undefined) settingsStoreRef.set(`memory.providers.${pid}.api_key`, cfg.api_key);
          if (cfg.base_url !== undefined) settingsStoreRef.set(`memory.providers.${pid}.base_url`, cfg.base_url);
        }
      }
      const config = settingsStoreRef.getMemoryConfig();
      jsonResponse(res, 200, { ok: true, config });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

async function handleAdminMemorySync(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = adminAuth(req, res);
  if (!user) return;
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  if (!memoryPoolRef) {
    jsonResponse(res, 503, { error: "memory system not enabled" });
    return;
  }
  try {
    const mgr = await memoryPoolRef.getOrCreate(user.id);
    await mgr.sync({ force: true });
    jsonResponse(res, 200, { ok: true, status: mgr.status() });
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

async function handleAdminMemorySearch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = adminAuth(req, res);
  if (!user) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  if (!memoryPoolRef) {
    jsonResponse(res, 503, { error: "memory system not enabled" });
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const query = url.searchParams.get("q") ?? "";
  if (!query.trim()) {
    jsonResponse(res, 400, { error: "query parameter 'q' is required" });
    return;
  }
  try {
    const mgr = await memoryPoolRef.getOrCreate(user.id);
    const results = await mgr.search(query);
    jsonResponse(res, 200, { results });
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Tool invocation API (admin only)
// ---------------------------------------------------------------------------

async function handleToolsList(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = adminAuth(req, res);
  if (!user) return;
  if (req.method !== "GET") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  if (!agentManagerRef) {
    jsonResponse(res, 503, { error: "agent manager unavailable" });
    return;
  }
  const tools = (await agentManagerRef.buildTools(user.id)).map((t) => ({
    name: t.name, label: t.label, description: t.description,
  }));
  tools.push({ name: "sandbox_exec", label: "Sandbox Exec", description: "Execute a command in Docker sandbox" });
  jsonResponse(res, 200, { tools });
}

async function handleToolsInvoke(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = adminAuth(req, res);
  if (!user) return;
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "method not allowed" });
    return;
  }
  if (!agentManagerRef) {
    jsonResponse(res, 503, { error: "agent manager unavailable" });
    return;
  }
  try {
    const body = await readJsonBody(req, 65536);
    const toolName = typeof body.tool === "string" ? body.tool : "";
    if (!toolName) {
      jsonResponse(res, 400, { error: "missing 'tool' field" });
      return;
    }
    const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
    const result = await agentManagerRef.invokeTool(toolName, args, user.id);
    if (result.ok) {
      jsonResponse(res, 200, { ok: true, result: result.result });
    } else {
      jsonResponse(res, 404, { ok: false, error: result.error });
    }
  } catch (err) {
    gatewayErrorResponse(res, err);
  }
}

// ---------------------------------------------------------------------------
// Admin: WeChat channel (QR code login flow)
// ---------------------------------------------------------------------------

// In-memory QR login session
let wechatQrSession: {
  qrcode: string;
  qrcodeUrl: string;
  status: "wait" | "scaned" | "confirmed" | "expired";
  startedAt: number;
} | null = null;

const WECHAT_QR_TTL_MS = 5 * 60_000; // 5 minutes

async function handleAdminChannelWechat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Auto-expire stale QR sessions
  if (wechatQrSession && Date.now() - wechatQrSession.startedAt > WECHAT_QR_TTL_MS) {
    wechatQrSession = null;
  }

  const authUser = adminAuth(req, res);
  if (!authUser) return;

  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  const url = new URL(req.url ?? "", "http://localhost");

  // POST /api/admin/channels/wechat/qr-start — request QR code
  if (req.method === "POST" && url.pathname.endsWith("/qr-start")) {
    try {
      const { fetchQRCode, DEFAULT_BASE_URL } = await import("./wechat-api.js");
      const baseUrl = settingsStoreRef.get("channel.wechat.base_url") || DEFAULT_BASE_URL;
      const qr = await fetchQRCode(baseUrl);
      wechatQrSession = {
        qrcode: qr.qrcode,
        qrcodeUrl: qr.qrcodeUrl,
        status: "wait",
        startedAt: Date.now(),
      };
      // Generate QR code image as base64 data URL (iframe/img won't work due to X-Frame-Options)
      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(qr.qrcodeUrl, { width: 280, margin: 2 });
      jsonResponse(res, 200, { qrcodeDataUrl: qrDataUrl });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // GET /api/admin/channels/wechat/qr-poll — poll scan status
  if (req.method === "GET" && url.pathname.endsWith("/qr-poll")) {
    if (!wechatQrSession) {
      jsonResponse(res, 400, { error: "no active QR session" });
      return;
    }
    try {
      const { pollQRStatus, DEFAULT_BASE_URL } = await import("./wechat-api.js");
      const baseUrl = settingsStoreRef.get("channel.wechat.base_url") || DEFAULT_BASE_URL;
      const result = await pollQRStatus(baseUrl, wechatQrSession.qrcode);
      wechatQrSession.status = result.status;

      if (result.status === "confirmed" && result.botToken && result.accountId) {
        // Save credentials
        settingsStoreRef.set("channel.wechat.token", encryptCred(result.botToken));
        settingsStoreRef.set("channel.wechat.base_url", result.baseUrl || baseUrl);
        settingsStoreRef.set("channel.wechat.account_id", result.accountId);
        settingsStoreRef.set("channel.wechat.enabled", "true");
        settingsStoreRef.set("channel.wechat.owner_id", authUser.id);

        hotStartChannel("wechat");

        wechatQrSession = null;
        jsonResponse(res, 200, {
          status: "confirmed",
          accountId: result.accountId,
          ok: true,
        });
      } else {
        jsonResponse(res, 200, { status: result.status });
      }
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // DELETE /api/admin/channels/wechat — disconnect
  if (req.method === "DELETE") {
    settingsStoreRef.set("channel.wechat.enabled", "false");
    settingsStoreRef.set("channel.wechat.token", "");
    settingsStoreRef.set("channel.wechat.base_url", "");
    settingsStoreRef.set("channel.wechat.account_id", "");
    settingsStoreRef.set("channel.wechat.owner_id", "");
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// Admin: DingTalk channel connect/disconnect
// ---------------------------------------------------------------------------

async function handleAdminChannelDingtalk(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const authUser = adminAuth(req, res);
  if (!authUser) return;

  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const clientId = String(parsed.client_id ?? "").trim();
      const clientSecret = String(parsed.client_secret ?? "").trim();
      if (!clientId || !clientSecret) {
        jsonResponse(res, 400, { error: "client_id and client_secret are required" });
        return;
      }

      // Validate credentials by getting access token
      const { probeDingtalkCredentials } = await import("./dingtalk-client.js");
      const probe = await probeDingtalkCredentials({ clientId, clientSecret });
      if (!probe.ok) {
        jsonResponse(res, 400, {
          ok: false,
          error: probe.error || "Failed to connect. Check Client ID and Client Secret.",
        });
        return;
      }

      settingsStoreRef.set("channel.dingtalk.client_id", clientId);
      settingsStoreRef.set("channel.dingtalk.client_secret", encryptCred(clientSecret));
      settingsStoreRef.set("channel.dingtalk.enabled", "true");
      settingsStoreRef.set("channel.dingtalk.owner_id", authUser.id);

      hotStartChannel("dingtalk");

      jsonResponse(res, 200, { ok: true, client_id: clientId, enabled: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    settingsStoreRef.set("channel.dingtalk.enabled", "false");
    settingsStoreRef.set("channel.dingtalk.client_id", "");
    settingsStoreRef.set("channel.dingtalk.client_secret", "");
    settingsStoreRef.set("channel.dingtalk.owner_id", "");
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

async function handleAdminChannelQQ(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const authUser = adminAuth(req, res);
  if (!authUser) return;

  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const appId = String(parsed.app_id ?? "").trim();
      const clientSecret = String(parsed.client_secret ?? "").trim();
      if (!appId || !clientSecret) {
        jsonResponse(res, 400, { error: "app_id and client_secret are required" });
        return;
      }

      // Validate credentials
      const { probeQQBotCredentials } = await import("./qq-api.js");
      const probe = await probeQQBotCredentials({ appId, clientSecret });
      if (!probe.ok) {
        jsonResponse(res, 400, {
          ok: false,
          error: probe.error || "Failed to connect. Check App ID and App Secret.",
        });
        return;
      }

      settingsStoreRef.set("channel.qq.app_id", appId);
      settingsStoreRef.set("channel.qq.client_secret", encryptCred(clientSecret));
      settingsStoreRef.set("channel.qq.enabled", "true");
      settingsStoreRef.set("channel.qq.owner_id", authUser.id);

      hotStartChannel("qq");

      jsonResponse(res, 200, { ok: true, app_id: appId, enabled: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    settingsStoreRef.set("channel.qq.enabled", "false");
    settingsStoreRef.set("channel.qq.app_id", "");
    settingsStoreRef.set("channel.qq.client_secret", "");
    settingsStoreRef.set("channel.qq.owner_id", "");
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

async function handleAdminChannelWecom(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const authUser = adminAuth(req, res);
  if (!authUser) return;

  if (!settingsStoreRef) {
    jsonResponse(res, 503, { error: "settings store unavailable" });
    return;
  }

  if (req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 4096);
      const botId = String(parsed.bot_id ?? "").trim();
      const secret = String(parsed.secret ?? "").trim();
      if (!botId || !secret) {
        jsonResponse(res, 400, { error: "bot_id and secret are required" });
        return;
      }

      // Validate credentials
      const { probeWecomCredentials } = await import("./wecom.js");
      const probe = await probeWecomCredentials({ botId, secret });
      if (!probe.ok) {
        jsonResponse(res, 400, {
          ok: false,
          error: probe.error || "Failed to connect. Check Bot ID and Secret.",
        });
        return;
      }

      settingsStoreRef.set("channel.wecom.bot_id", botId);
      settingsStoreRef.set("channel.wecom.secret", encryptCred(secret));
      settingsStoreRef.set("channel.wecom.enabled", "true");
      settingsStoreRef.set("channel.wecom.owner_id", authUser.id);

      hotStartChannel("wecom");

      jsonResponse(res, 200, { ok: true, bot_id: botId, enabled: true });
    } catch (err) {
      gatewayErrorResponse(res, err);
    }
    return;
  }

  if (req.method === "DELETE") {
    settingsStoreRef.set("channel.wecom.enabled", "false");
    settingsStoreRef.set("channel.wecom.bot_id", "");
    settingsStoreRef.set("channel.wecom.secret", "");
    settingsStoreRef.set("channel.wecom.owner_id", "");
    jsonResponse(res, 200, { ok: true });
    return;
  }

  jsonResponse(res, 405, { error: "method not allowed" });
}

// ---------------------------------------------------------------------------
// File download handler
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  zip: "application/zip",
  gz: "application/gzip",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

async function handleFileDownload(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<void> {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    jsonResponse(res, 429, { error: "too many requests" });
    return;
  }

  const auth = authenticateRequest(req);
  if (auth.kind === "invalid") {
    jsonResponse(res, 401, { error: "unauthorized" });
    return;
  }

  // Validate token format (alphanumeric only)
  if (!/^[a-z0-9]+$/.test(token)) {
    jsonResponse(res, 400, { error: "invalid token" });
    return;
  }

  const entry = downloadTokens.get(token);
  if (!entry) {
    jsonResponse(res, 404, { error: "file not found or expired" });
    return;
  }

  // Only the same user (or admin) can download
  if (entry.userId !== auth.user.id && auth.kind !== "admin") {
    jsonResponse(res, 403, { error: "forbidden" });
    return;
  }

  // Check expiry
  if (Date.now() >= entry.expiresAt) {
    downloadTokens.delete(token);
    jsonResponse(res, 410, { error: "download link expired" });
    return;
  }

  const { stat, createReadStream } = await import("node:fs/promises").then(
    async (fsp) => ({
      stat: fsp.stat,
      createReadStream: (await import("node:fs")).createReadStream,
    }),
  );

  try {
    const fileStat = await stat(entry.path);
    if (!fileStat.isFile()) {
      jsonResponse(res, 404, { error: "file not found" });
      return;
    }
    if (fileStat.size > MAX_DOWNLOAD_SIZE) {
      jsonResponse(res, 413, { error: "file too large" });
      return;
    }

    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(entry.name)}"`,
      "Content-Length": fileStat.size,
      "Cache-Control": "private, no-cache",
    });

    const stream = createReadStream(entry.path);
    stream.pipe(res);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  } catch {
    jsonResponse(res, 404, { error: "file not found" });
  }
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: WebConfig,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${cfg.port}`);

  switch (url.pathname) {
    case "/":
      return serveHtml(req, res);
    case "/login":
      return serveLogin(res, cfg);
    case "/admin":
      return serveAdmin(req, res);
    case "/logo.png":
      return servePublicFile(res, "logo.png", "image/png");
    case "/avatar.jpg":
      return servePublicFile(res, "avatar.jpg", "image/jpeg");
    case "/feishu.png":
      return servePublicFile(res, "feishu.png", "image/jpeg");
    case "/dingtalk.png":
      return servePublicFile(res, "dingtalk.png", "image/jpeg");
    case "/wechat-icon.png":
      return servePublicFile(res, "wechat-icon.png", "image/jpeg");
    case "/qq-icon.png":
      return servePublicFile(res, "qq-icon.png", "image/jpeg");
    case "/wecom-icon.png":
      return servePublicFile(res, "wecom-icon.png", "image/jpeg");

    // Auth routes
    case "/api/auth/register":
      if (!inviteStoreRef || !userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAuthRegister(req, res, cfg, userStoreRef, inviteStoreRef);
    case "/api/auth/login":
      if (!userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAuthLogin(req, res, cfg, userStoreRef);
    case "/api/auth/logout":
      if (!userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAuthLogout(req, res, userStoreRef);
    case "/api/auth/me":
      if (!userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAuthMe(req, res, userStoreRef, cfg);
    case "/api/auth/profile": {
      const profIp = req.socket.remoteAddress || "";
      if (!checkRateLimit(profIp)) {
        jsonResponse(res, 429, { error: "too_many_requests" });
        return;
      }
      if (!userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAuthProfile(req, res, userStoreRef);
    }
    case "/api/auth/avatar": {
      const avatarIp = req.socket.remoteAddress || "";
      if (!checkRateLimit(avatarIp)) {
        jsonResponse(res, 429, { error: "too_many_requests" });
        return;
      }
      if (!userStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleAvatarUpload(req, res, userStoreRef);
    }
    case "/api/auth/google":
      return handleGoogleRedirect(req, res, cfg);
    case "/api/auth/google/callback":
      if (!userStoreRef || !inviteStoreRef) {
        jsonResponse(res, 503, { error: "not ready" });
        return;
      }
      return handleGoogleCallback(req, res, cfg, userStoreRef, inviteStoreRef);

    // Admin routes
    case "/api/admin/invites":
      return handleAdminInvites(req, res);
    case "/api/admin/users":
      return handleAdminUsers(req, res);
    case "/api/admin/sessions":
      return handleAdminSessions(req, res);
    case "/api/admin/history":
      return handleAdminHistory(req, res);
    case "/api/admin/settings":
      return handleAdminSettings(req, res);
    case "/api/admin/cron/tasks":
      return handleAdminCronTasks(req, res);
    case "/api/admin/models":
      return handleAdminModels(req, res);
    case "/api/admin/providers":
      return handleAdminProviders(req, res);
    case "/api/admin/providers/reload":
      return handleAdminProvidersReload(req, res);
    case "/api/admin/capabilities":
      return handleAdminCapabilities(req, res);
    case "/auth/provider/start":
      return handleOAuthStart(req, res, cfg);
    case "/auth/provider/callback":
      return handleOAuthCallback(req, res);
    case "/api/admin/prompts":
      return handleAdminPrompts(req, res);
    case "/api/admin/rules":
      return handleAdminRules(req, res);
    case "/api/admin/mcp":
      return handleAdminMcp(req, res);
    case "/api/admin/skills":
      return handleAdminSkills(req, res);
    case "/api/admin/skills/install":
      return handleAdminSkillsInstall(req, res);
    case "/api/admin/channels":
      return handleAdminChannels(req, res);
    case "/api/admin/channels/feishu":
      return handleAdminChannelFeishu(req, res);
    case "/api/admin/channels/dingtalk":
      return handleAdminChannelDingtalk(req, res);
    case "/api/admin/channels/wechat":
    case "/api/admin/channels/wechat/qr-start":
    case "/api/admin/channels/wechat/qr-poll":
      return handleAdminChannelWechat(req, res);
    case "/api/admin/channels/qq":
      return handleAdminChannelQQ(req, res);
    case "/api/admin/channels/wecom":
      return handleAdminChannelWecom(req, res);
    case "/api/admin/memory":
      return handleAdminMemory(req, res);
    case "/api/admin/memory/sync":
      return handleAdminMemorySync(req, res);
    case "/api/admin/memory/search":
      return handleAdminMemorySearch(req, res);

    // Tool invocation API
    case "/api/tools":
      return handleToolsList(req, res);
    case "/api/tools/invoke":
      return handleToolsInvoke(req, res);
    // Upload
    case "/api/upload":
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "method not allowed" });
        return;
      }
      return handleUpload(req, res);

    // History
    case "/api/history": {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "method not allowed" });
        return;
      }
      const histIp = getClientIp(req);
      if (!checkRateLimit(histIp)) {
        jsonResponse(res, 429, { error: "too many requests" });
        return;
      }
      const histAuth = authenticateRequest(req);
      if (histAuth.kind === "invalid") {
        jsonResponse(res, 401, { error: "unauthorized" });
        return;
      }
      const histSessionId = url.searchParams.get("sessionId") ?? "default";
      if (!isValidGatewaySessionId(histSessionId)) {
        jsonResponse(res, 400, { error: "invalid sessionId" });
        return;
      }
      // Channel sessions: only the channel owner can access
      const channelOwnerChecks: Record<string, string> = {
        "feishu:": "channel.feishu.owner_id",
        "dingtalk:": "channel.dingtalk.owner_id",
        "wechat:": "channel.wechat.owner_id",
        "qq:": "channel.qq.owner_id",
        "wecom:": "channel.wecom.owner_id",
      };
      for (const [prefix, ownerKey] of Object.entries(channelOwnerChecks)) {
        if (histSessionId.startsWith(prefix)) {
          const ownerId = settingsStoreRef?.get(ownerKey);
          if (ownerId && ownerId !== histAuth.user.id) {
            jsonResponse(res, 403, { error: "access denied" });
            return;
          }
          break;
        }
      }
      const limitStr = url.searchParams.get("limit") ?? "200";
      const limit = Math.min(Math.max(parseInt(limitStr, 10) || 200, 1), 500);
      try {
        const result = await gateway.readHistory({
          userId: histAuth.user.id,
          sessionId: histSessionId,
          limit,
        });
        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 503, { error: String(err) });
      }
      return;
    }

    // Sessions
    case "/api/sessions": {
      const sessIp = getClientIp(req);
      if (!checkRateLimit(sessIp)) {
        jsonResponse(res, 429, { error: "too many requests" });
        return;
      }
      const sessAuth = authenticateRequest(req);
      if (sessAuth.kind === "invalid") {
        jsonResponse(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "GET") {
        try {
          // Build list of channel prefixes this user can see
          const channels: string[] = [];
          const feishuOwnerId = settingsStoreRef?.get("channel.feishu.owner_id");
          if (!feishuOwnerId || feishuOwnerId === sessAuth.user.id) channels.push("feishu:");
          const dtOwnerId = settingsStoreRef?.get("channel.dingtalk.owner_id");
          if (!dtOwnerId || dtOwnerId === sessAuth.user.id) channels.push("dingtalk:");
          const wxOwnerId = settingsStoreRef?.get("channel.wechat.owner_id");
          if (!wxOwnerId || wxOwnerId === sessAuth.user.id) channels.push("wechat:");
          const qqOwnerId = settingsStoreRef?.get("channel.qq.owner_id");
          if (!qqOwnerId || qqOwnerId === sessAuth.user.id) channels.push("qq:");
          const wecomOwnerId = settingsStoreRef?.get("channel.wecom.owner_id");
          if (!wecomOwnerId || wecomOwnerId === sessAuth.user.id) channels.push("wecom:");
          const result = await gateway.listSessions({
            userId: sessAuth.user.id,
            includeChannels: channels,
          });
          jsonResponse(res, 200, result);
        } catch (err) {
          jsonResponse(res, 503, { error: String(err) });
        }
        return;
      }

      if (req.method === "DELETE") {
        const delSessionId = url.searchParams.get("sessionId") ?? "";
        if (!isValidGatewaySessionId(delSessionId)) {
          jsonResponse(res, 400, { error: "invalid sessionId" });
          return;
        }
        try {
          const deleted = gateway.deleteSession({
            userId: sessAuth.user.id,
            sessionId: delSessionId,
          });
          if (!deleted) {
            jsonResponse(res, 404, { error: "session not found" });
            return;
          }
          jsonResponse(res, 200, { deleted: true });
        } catch (err) {
          jsonResponse(res, 503, { error: String(err) });
        }
        return;
      }

      jsonResponse(res, 405, { error: "method not allowed" });
      return;
    }

    case "/api/health":
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    default:
      // File download: /api/files/<token>
      if (url.pathname.startsWith("/api/files/") && req.method === "GET") {
        return handleFileDownload(
          req,
          res,
          url.pathname.slice("/api/files/".length),
        );
      }
      // Avatar serving: /api/avatars/<filename>
      if (url.pathname.startsWith("/api/avatars/") && req.method === "GET") {
        const fileName = url.pathname.slice("/api/avatars/".length);
        return handleAvatarServe(req, res, fileName);
      }
      {
        const auth = authenticateRequest(req);
        const handled = await gateway.dispatchCapabilityHttpRoute({
          pathname: url.pathname,
          req,
          res,
          isAuthenticated: auth.kind !== "invalid",
        });
        if (handled) {
          return;
        }
      }
      res.writeHead(404);
      res.end("not found");
  }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/**
 * Deliver a message proactively to a Web channel user via WebSocket.
 * `to` can be a userId or "*" to broadcast to all connected users.
 */
function deliverWebMessage(to: string, text: string): Promise<void> {
  const event: WsEvent = {
    type: "message",
    text,
    id: `cron-${Date.now().toString(36)}`,
  };

  if (to === "*") {
    gateway.deliverMessage("*", text);
  } else if (gateway.hasConnectedUser(to)) {
    gateway.deliverMessage(to, text);
  } else {
    console.warn(
      `[Web] deliver: user "${to}" has no active WebSocket connection, message dropped`,
    );
  }

  return Promise.resolve();
}

export const webPlugin: ChannelPlugin = {
  meta: {
    id: "web",
    label: "Web Chat",
    description:
      "Browser-based chat UI (localhost + optional Cloudflare Tunnel)",
  },
  capabilities: {
    chatTypes: ["direct"],
    dm: true,
  },
  deliver: deliverWebMessage,

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    isEnabled: () => true,
    isConfigured: () => true,
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext) => {
    const handler = ctx.handler;
    const cfg = loadWebConfig();

    // Apply services from ChannelContext if available (new architecture)
    if (ctx.services) {
      if (ctx.services.messageStore && !messageStoreRef) setMessageStore(ctx.services.messageStore as MessageStore);
      if (ctx.services.inviteStore && !inviteStoreRef) setInviteStore(ctx.services.inviteStore as InviteStore);
      if (ctx.services.userStore && !userStoreRef) setUserStore(ctx.services.userStore as UserStore);
      if (ctx.services.settingsStore && !settingsStoreRef) setSettingsStore(ctx.services.settingsStore as import("../settings-store.js").SettingsStore);
      if (ctx.services.memoryPool && !memoryPoolRef) setMemoryPool(ctx.services.memoryPool as import("../memory/pool.js").MemoryManagerPool);
      if (ctx.services.agentManager && !agentManagerRef) setAgentManager(ctx.services.agentManager as import("../agent-manager.js").AgentSessionManager);
      if (ctx.services.handler && !handlerRef) setHandler(ctx.services.handler as Handler);
      if (ctx.services.cronScheduler && !cronSchedulerRef) setCronScheduler(ctx.services.cronScheduler as NonNullable<typeof cronSchedulerRef>);
      if (ctx.services.channelManager) channelManagerRef = ctx.services.channelManager as import("./manager.js").ChannelManager;
    }

    const server = createServer((req, res) => {
      handleRequest(req, res, cfg).catch((err) => {
        console.error("[Web] Request error:", err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("internal error");
        }
      });
    });

    // WebSocket server (noServer mode — manual upgrade handling via cookie)
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://localhost:${cfg.port}`);
      if (url.pathname !== "/api/ws") {
        socket.destroy();
        return;
      }

      // Authenticate: try local token first (macOS app), then cookie
      const localToken = req.headers["x-klaus-local-token"]?.toString() ?? null;

      if (localToken && validateLocalToken(localToken)) {
        // Local token auth — create a synthetic admin user for the macOS app
        const localUser: User = {
          id: "__local__",
          email: "local@klaus",
          displayName: "Klaus App",
          role: "admin",
          avatarUrl: null,
          googleId: null,
          inviteCode: "",
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
          isActive: true,
        };
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, localUser);
        });
        return;
      }

      // Authenticate via cookie
      const auth = authenticateRequest(req);
      if (auth.kind === "invalid") {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, auth.user);
      });
    });

    wss.on(
      "connection",
      (rawWs: WebSocket, req: IncomingMessage, user: User) => {
        const ws = rawWs as KlausWebSocket;
        ws.isAlive = true;
        ws.klausUserId = user.id;
        ws.klausIp = getClientIp(req);

        gateway.registerClient(user.id, ws);
        console.log(`[Web] WebSocket connected: ${userLabel(user)}`);

        ws.on("pong", () => {
          ws.isAlive = true;
        });

        ws.on("message", (raw: RawData) => {
          handleWsMessage(ws, raw, handler, cfg);
        });

        ws.on("close", () => {
          gateway.unregisterClient(user.id, ws);
          console.log(`[Web] WebSocket disconnected: ${userLabel(user)}`);
        });

        ws.on("error", (err) => {
          console.error(
            `[Web] WebSocket error (${userLabel(user)}):`,
            err.message,
          );
          gateway.unregisterClient(user.id, ws);
        });
      },
    );

    server.listen(cfg.port, "0.0.0.0", () => {
      console.log(
        `Klaus Web channel listening on http://localhost:${cfg.port}`,
      );
      console.log(`Login: http://localhost:${cfg.port}/login`);
      console.log(
        `Admin: http://localhost:${cfg.port}/admin (requires admin role)`,
      );
    });

    // Config file watcher
    let configWatcher: FSWatcher | null = null;
    let configDebounce: ReturnType<typeof setTimeout> | null = null;
    try {
      configWatcher = watch(CONFIG_FILE, () => {
        if (configDebounce) clearTimeout(configDebounce);
        configDebounce = setTimeout(() => {
          configDebounce = null;
          console.log("[Web] Config file changed, notifying clients");
          gateway.broadcastEvent({ type: "config_updated" });
        }, 500);
      });
    } catch {
      // config.yaml may not exist yet
    }

    // Application-layer ping — 25s keepalive
    const keepalive = setInterval(() => {
      for (const client of wss.clients) {
        const ws = client as KlausWebSocket;
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            gateway.unregisterClient(ws.klausUserId, ws);
          }
        } else {
          gateway.unregisterClient(ws.klausUserId, ws);
        }
      }
    }, 25_000);

    // Protocol-layer ping/pong — detect dead connections
    const deadCheck = setInterval(() => {
      for (const client of wss.clients) {
        const ws = client as KlausWebSocket;
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30_000);

    // Cleanup on process exit
    const cleanup = (): void => {
      clearInterval(keepalive);
      clearInterval(deadCheck);
      if (configDebounce) clearTimeout(configDebounce);
      configWatcher?.close();
      wss.close();
      server.close();
    };
    process.once("exit", cleanup);

    ctx.setStatus({ connected: true, lastConnectedAt: Date.now() });

    // Block until abort signal
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        cleanup();
        resolve();
      };
      if (ctx.signal.aborted) { onAbort(); return; }
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
    },
  },
};
