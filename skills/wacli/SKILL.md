---
name: wacli
description: "Send WhatsApp messages and search/sync WhatsApp history via wacli CLI."
metadata: { "klaus": { "emoji": "💬", "requires": { "bins": ["wacli"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/wacli", "label": "Install wacli (brew)" }] } }
---

# wacli — WhatsApp CLI

Send WhatsApp messages and search/sync chat history.

## When to Use

- User asks to send a WhatsApp message
- Searching WhatsApp conversation history
- Syncing WhatsApp data for reference

## When NOT to Use

- Normal WhatsApp chat (if Klaus has a WhatsApp channel configured) → channel handles it
- This skill is for **proactive sending** from other channels (Web, Feishu, etc.)

## Setup

```bash
brew install steipete/tap/wacli

# First run: pair with phone via QR code
wacli auth
```

## Commands

### Send Message

```bash
wacli send "+14155551212" "Hello from Klaus!"
wacli send "+14155551212" --file /path/to/image.jpg "Check this out"
```

### Search History

```bash
wacli search "query" --limit 20
wacli search "query" --chat "+14155551212"
```

### List Chats

```bash
wacli chats --limit 20
wacli chats --json
```

### Sync

```bash
wacli sync                    # Sync recent messages
wacli sync --days 7           # Sync last 7 days
```

## SECURITY — CRITICAL

- Always confirm recipient and message content before sending
- Never send to unknown numbers without explicit user approval
- Don't mass-message or spam

## Notes

- Requires phone pairing via QR code on first use
- Messages sent as the user's WhatsApp account (not a bot)
- Rate limit yourself to avoid WhatsApp restrictions
