---
name: himalaya
description: "CLI email client via IMAP/SMTP — list, read, write, reply, forward, search emails."
metadata: { "klaus": { "emoji": "📧", "requires": { "bins": ["himalaya"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "himalaya", "label": "Install Himalaya (brew)" }] } }
---

# Himalaya Email CLI

Manage emails from the terminal via IMAP/SMTP.

## When to Use

- User asks to check, read, or send email
- Searching email history
- Replying to or forwarding emails
- Managing email folders

## Setup

```bash
brew install himalaya

# Interactive account setup
himalaya account configure

# Or create ~/.config/himalaya/config.toml manually
```

Config example (`~/.config/himalaya/config.toml`):

```toml
[accounts.personal]
email = "you@example.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@example.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show email/imap"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 465
message.send.backend.encryption.type = "tls"
message.send.backend.login = "you@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show email/smtp"
```

## Commands

### List & Read

```bash
himalaya envelope list                    # List inbox
himalaya envelope list -f Sent            # List sent
himalaya envelope list -s "query"         # Search
himalaya message read <id>                # Read message
himalaya message read <id> --html         # Read HTML version
```

### Write & Send

```bash
# Write new email (opens editor)
himalaya message write

# Reply
himalaya message reply <id>

# Forward
himalaya message forward <id>
```

### Organize

```bash
himalaya message move <id> -f Archive     # Move
himalaya message delete <id>              # Delete
himalaya flag add <id> seen               # Mark read
himalaya flag remove <id> seen            # Mark unread
```

### Folders

```bash
himalaya folder list                      # List folders
himalaya folder create "New Folder"       # Create
himalaya folder delete "Old Folder"       # Delete
```

### Accounts

```bash
himalaya account list                     # List accounts
himalaya account configure                # Setup wizard
himalaya -a work envelope list            # Use specific account
```

## SECURITY — CRITICAL

- Never print or log email credentials
- Use password manager commands for auth (e.g., `pass`, `op`)
- Confirm recipient before sending emails
- Don't forward emails without user consent

## Notes

- Supports IMAP, Notmuch, Maildir backends
- Multiple accounts supported
- Password can come from command (`auth.cmd`), keyring, or raw value
