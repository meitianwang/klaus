---
name: imsg
description: "Send and read iMessage/SMS via macOS Messages.app."
metadata: { "klaus": { "emoji": "📨", "os": ["darwin"], "requires": { "bins": ["imsg"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/imsg", "label": "Install imsg (brew)" }] } }
---

# imsg

Read and send iMessage/SMS via macOS Messages.app.

## When to Use

- User asks to send an iMessage or SMS
- Reading iMessage conversation history
- Checking recent chats

## When NOT to Use

- Telegram/Signal/WhatsApp → use respective channels
- Group chat management (add/remove members) → not supported
- Bulk messaging → always confirm with user first

## Setup

- macOS with Messages.app signed in
- Full Disk Access for terminal
- Automation permission for Messages.app

## Commands

### List Chats

```bash
imsg chats --limit 10 --json
```

### View History

```bash
imsg history --chat-id 1 --limit 20 --json
imsg history --chat-id 1 --limit 20 --attachments --json
```

### Send Messages

```bash
# Text
imsg send --to "+14155551212" --text "Hello!"

# With attachment
imsg send --to "+14155551212" --text "Check this" --file /path/to/image.jpg

# Force service
imsg send --to "+14155551212" --text "Hi" --service imessage
imsg send --to "+14155551212" --text "Hi" --service sms
```

### Watch for New Messages

```bash
imsg watch --chat-id 1 --attachments
```

## SECURITY — CRITICAL

- Always confirm recipient and message content before sending
- Never send to unknown numbers without explicit user approval
- Verify file paths exist before sending attachments

## Example Workflow

User: "Text mom that I'll be late"

```bash
# 1. Find mom's chat
imsg chats --limit 20 --json | jq '.[] | select(.displayName | contains("Mom"))'

# 2. Confirm: "Found Mom at +1555123456. Send 'I'll be late'?"

# 3. After user confirms
imsg send --to "+1555123456" --text "I'll be late"
```

## Notes

- macOS only
- `--service auto` (default) lets Messages.app decide iMessage vs SMS
- Rate limit yourself — don't spam
