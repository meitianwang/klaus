# Claude Paw

Use Claude Code from QQ / WeChat Work (企业微信).

Claude Paw wraps the [Claude Code SDK](https://www.npmjs.com/package/@anthropic-ai/claude-code) and exposes it as a chatbot on messaging platforms. Multi-turn conversations, session management, and a collect mode that merges concurrent messages are handled automatically.

## Install

### npm (recommended)

```bash
npm install -g claude-paw
```

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/meitianwang/cpaw/main/install.sh | bash
```

The script installs Node.js (if missing), Claude Code CLI, and Claude Paw.

## Prerequisites

- **Node.js >= 18**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- A configured Claude Code account (`claude` login)

## Quick Start

```bash
# 1. Start — auto-launches setup wizard on first run
cpaw start

# Or run setup separately
cpaw setup

# Diagnose issues
cpaw doctor
```

## Supported Channels

| Channel | Transport | Public IP |
|---------|-----------|-----------|
| QQ Bot | WebSocket | Not needed |
| WeChat Work | HTTP Callback | Required |

### QQ Bot

1. Go to [QQ Bot Platform](https://q.qq.com/) and create a bot
2. Get AppID and AppSecret from Development > Settings
3. Run `cpaw setup` and select QQ
4. Add test users at Development > Sandbox Config
5. Scan the sandbox QR code with your phone QQ to start chatting

> `qq-group-bot` is auto-installed when you select QQ channel during setup.

### WeChat Work (WeCom)

1. Log in at [work.weixin.qq.com](https://work.weixin.qq.com/)
2. Get Corp ID from My Enterprise page
3. Create an app, get Agent ID + Secret
4. Set the callback URL in Receive Messages section
5. Run `cpaw setup` and select WeCom

**Tip**: Use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose a local port:

```bash
cloudflared tunnel --url http://localhost:8080
```

## Configuration

Config file: `~/.cpaw/config.yaml`

```yaml
channel: qq          # or wecom
persona: "You are a helpful AI assistant."

qq:
  appid: "your-appid"
  secret: "your-secret"

wecom:
  corp_id: "your-corp-id"
  corp_secret: "your-secret"
  agent_id: 1000002
  token: "callback-token"
  encoding_aes_key: "aes-key"
  port: 8080
```

Environment variables (`QQ_BOT_APPID`, `WECOM_CORP_ID`, etc.) override config file values.

## Chat Commands

| Command | Effect |
|---------|--------|
| `/new` `/reset` `/clear` | Reset conversation |

## How It Works

```
User message → Channel (QQ/WeCom) → SessionManager → ClaudeChat → Claude Code SDK
                                         ↑
                                    LRU eviction
                                    (max 20 sessions)
```

- **Collect mode**: If Claude is busy, incoming messages are queued and merged into one prompt when the current turn finishes.
- **LRU sessions**: Up to 20 concurrent sessions; idle sessions are evicted first.

## License

MIT
