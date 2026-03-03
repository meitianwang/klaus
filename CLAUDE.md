# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Klaus** (`klaus-ai` on npm) is a TypeScript CLI tool that bridges Claude Code (via `@anthropic-ai/claude-agent-sdk`) to messaging platforms (QQ, WeChat Work). It runs as a global npm package exposing the `klaus` command.

## Commands

```bash
npm run dev          # Run directly via tsx (development)
npm run build        # Bundle with tsup → dist/
npm run typecheck    # Type check with tsc --noEmit
```

No test framework is configured. No linter is configured.

## Architecture

### Core Flow

```
User message → Channel (QQ/WeCom) → ChatSessionManager → ClaudeChat → Claude Agent SDK → Reply
```

### Key Modules

- **`src/core.ts`** — `ClaudeChat` (single-session Claude interaction) + `ChatSessionManager` (LRU pool of up to 20 sessions). Implements **Collect mode**: when Claude is busy processing, incoming messages queue up and get merged into one follow-up prompt instead of being handled individually. Callers of merged messages receive `null` (skip reply).

- **`src/channels/base.ts`** — Abstract `Channel` base class. Subclasses implement `start(handler)` which must block forever. `Handler` type: `(sessionKey: string, text: string) => Promise<string | null>`.

- **`src/channels/qq.ts`** — QQ bot via WebSocket (`qq-group-bot` SDK, auto-installed if missing). Session keys: `c2c:{openid}` or `group:{openid}`.

- **`src/channels/wecom.ts`** — WeChat Work via HTTP webhook with AES-256-CBC encryption + SHA1 signature verification. Session keys: `wecom:{userId}`.

- **`src/index.ts`** — CLI entry point. Routes `setup`/`start`/`doctor` subcommands. Handles special messages (`/new`, `/reset`, `/clear`) to reset sessions.

- **`src/config.ts`** — YAML config at `~/.klaus/config.yaml`, with env var fallback.

- **`src/i18n.ts`** — Bilingual (EN/ZH) translation system for setup wizard and guides.

- **`src/setup-wizard.ts`** — Interactive TUI setup using `@clack/prompts`.

- **`src/doctor.ts`** — Environment diagnostic checks (Node version, Claude CLI, config, credentials).

### Design Patterns

- **Collect mode** (`core.ts`): Uses a `Deferred<T>` promise wrapper to queue concurrent messages while Claude is processing. Merged messages are prefixed with a Chinese explanation string.
- **LRU session eviction** (`core.ts`): Leverages `Map` insertion order. When the pool reaches 20 sessions, the oldest non-busy session is evicted.
- **Channel abstraction**: New channels extend `Channel` and implement `start()`. See `.claude/skills/add-channel/SKILL.md` for the step-by-step guide (note: the skill references the earlier Python version — adapt the patterns to TypeScript).

### Config Structure

```yaml
channel: "qq" | "wecom"
persona: "optional system prompt"
qq:
  appid: "..."
  secret: "..."
wecom:
  corpId: "..."
  corpSecret: "..."
  agentId: 123
  token: "..."
  encodingAesKey: "..."
  port: 8080
```

## Reference: OpenClaw

项目根目录下的 `openclaw/` 是 [OpenClaw](https://github.com/openclaw/openclaw) 的源码副本（已加入 .gitignore，不会被提交）。OpenClaw 是功能类似的开源项目，支持 WhatsApp、Telegram、Slack、Discord 等多种平台。

**当需要参考实现思路时（如新增通道、会话管理、消息处理等），直接读取 `openclaw/` 目录下的源码**，不要凭记忆猜测。

## Conventions

- ESM-only (`"type": "module"` in package.json)
- TypeScript strict mode enabled
- Target: ES2022, Node >= 18
- All user-facing text must be bilingual (EN + ZH) via the i18n system
- The `start()` method on channels must block forever (never return until shutdown)
- Handler returns `null` to signal "message was merged, skip reply"
