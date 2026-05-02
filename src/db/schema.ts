/**
 * Drizzle PG schema — Klaus Web 端云端的所有「Klaus 加的」表 (13 张)。
 *
 * 边界（决策 #5）：CC 引擎管的存储 (transcripts JSONL / ~/.claude/tasks/) 不在
 * 这里，继续走本地文件系统。本 schema 只描述 Klaus 自己加的关系数据。
 *
 * 多租户隔离（决策 #4 + RLS）：所有 per-user 表都带 `userId UUID NOT NULL`
 * 外键到 users.id，配合 src/db/migrations/*_rls.sql 里的 policy，应用层不再
 * 需要写 `WHERE user_id = $1`。
 *
 * 跟桌面端 SQLite schema 的关系：表结构对齐但类型映射 PG 化
 * (TEXT → uuid/text/citext, INTEGER → bigint, INTEGER 0/1 → boolean,
 *  JSON 文本 → jsonb)。两端各走各的迁移路径，不强制 schema 同步（决策 #4）。
 */

import {
  pgTable,
  text,
  uuid,
  boolean,
  bigint,
  integer,
  numeric,
  timestamp,
  jsonb,
  customType,
  primaryKey,
  uniqueIndex,
  index,
  inet,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// CITEXT (case-insensitive) for emails. drizzle-orm has no first-class citext,
// so we declare it via customType.
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

// ============================================================================
// A 类: 平台全局（无 user_id, admin 配一次全用户读）
// ============================================================================

export const platformModels = pgTable("platform_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  maxContextTokens: integer("max_context_tokens").notNull().default(200000),
  thinking: text("thinking").notNull().default("off"),
  isDefault: boolean("is_default").notNull().default(false),
  // role: sonnet / haiku / opus / null — for CC engine env overrides
  role: text("role"),
  costInput: numeric("cost_input", { precision: 10, scale: 6 }),
  costOutput: numeric("cost_output", { precision: 10, scale: 6 }),
  costCacheRead: numeric("cost_cache_read", { precision: 10, scale: 6 }),
  costCacheWrite: numeric("cost_cache_write", { precision: 10, scale: 6 }),
  // OAuth / api_key 凭证: api_key 本身不存这里 (决策 #1: 平台共享, 从 env / KMS 取)
  authType: text("auth_type").default("api_key"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: bigint("token_expires_at", { mode: "number" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const platformPrompts = pgTable("platform_prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const inviteCodes = pgTable(
  "invite_codes",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    usedBy: text("used_by"),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    activeIdx: index("idx_invite_active").on(t.isActive),
  }),
);

// ============================================================================
// B 类: 用户私有（per-user 读写, 必须 RLS）
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull().default(""),
    displayName: text("display_name").notNull().default(""),
    avatarUrl: text("avatar_url"),
    role: text("role").notNull().default("user"),
    googleId: text("google_id"),
    inviteCode: text("invite_code").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    // 平台用量配额（决策 #1 配套）
    monthlyTokenQuota: bigint("monthly_token_quota", { mode: "number" })
      .notNull()
      .default(1_000_000),
    monthlyTokenUsed: bigint("monthly_token_used", { mode: "number" })
      .notNull()
      .default(0),
    quotaResetAt: timestamp("quota_reset_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    googleIdUnique: uniqueIndex("users_google_id_unique").on(t.googleId),
  }),
);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.key] }),
  }),
);

export const userPrompts = pgTable(
  "user_prompts",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_user_prompts_user").on(t.userId),
  }),
);

export const cronTasks = pgTable(
  "cron_tasks",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    description: text("description"),
    schedule: text("schedule").notNull(),
    prompt: text("prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    thinking: text("thinking"),
    lightContext: boolean("light_context").default(false),
    timeoutSeconds: integer("timeout_seconds"),
    deleteAfterRun: boolean("delete_after_run").default(false),
    deliver: jsonb("deliver"),
    webhookUrl: text("webhook_url"),
    webhookToken: text("webhook_token"),
    failureAlert: jsonb("failure_alert"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userEnabledIdx: index("idx_cron_user_enabled").on(t.userId, t.enabled),
  }),
);

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    taskId: text("task_id")
      .notNull()
      .references(() => cronTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull(),
    error: text("error"),
  },
  (t) => ({
    taskIdx: index("idx_cron_runs_task").on(t.taskId, t.startedAt),
    userIdx: index("idx_cron_runs_user").on(t.userId),
  }),
);

// Klaus 自己加的 sessions 索引表 (决策 #5: transcript 内容仍在 CC 引擎本地 JSONL)
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    cwd: text("cwd"),
    transcriptPath: text("transcript_path"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    userIdx: index("idx_sessions_user").on(t.userId, t.lastActiveAt),
  }),
);

export const sessionArtifacts = pgTable(
  "session_artifacts",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    lastOp: text("last_op").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastModifiedAt: timestamp("last_modified_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionPathUnique: uniqueIndex("session_artifacts_session_path_unique").on(
      t.sessionId,
      t.filePath,
    ),
    userIdx: index("idx_session_artifacts_user").on(t.userId),
  }),
);

// ============================================================================
// E 类: 短期会话状态 (UNLOGGED 表 — Postgres 不写 WAL，重启数据丢失也 OK)
// ============================================================================
//
// drizzle-kit 当前不支持 UNLOGGED 表选项；初始化 migration 里手工 ALTER 即可。
// 这里先以普通表声明，应用层无感。

export const authSessions = pgTable(
  "auth_sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({
    userIdx: index("idx_auth_user").on(t.userId),
    expiresIdx: index("idx_auth_expires").on(t.expiresAt),
  }),
);

export const desktopAuthCodes = pgTable("desktop_auth_codes", {
  code: text("code").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
});

export const desktopTokens = pgTable(
  "desktop_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceInfo: text("device_info").default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    userIdx: index("idx_desktop_tokens_user").on(t.userId),
  }),
);

// ============================================================================
// 平台用量审计 (决策 #1 配套)
// ============================================================================

export const tokenUsage = pgTable(
  "token_usage",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheRead: integer("cache_read").notNull().default(0),
    cacheWrite: integer("cache_write").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userTimeIdx: index("idx_usage_user_time").on(t.userId, t.occurredAt),
    modelIdx: index("idx_usage_model").on(t.modelId, t.occurredAt),
  }),
);

// ============================================================================
// Per-user 表清单 — 给 RLS migration 和 connection middleware 用
// ============================================================================

export const PER_USER_TABLES = [
  "users",
  "user_settings",
  "user_prompts",
  "cron_tasks",
  "cron_runs",
  "sessions",
  "session_artifacts",
  "token_usage",
] as const;
