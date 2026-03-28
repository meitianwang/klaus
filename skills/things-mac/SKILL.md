---
name: things-mac
description: "Manage Things 3 tasks via things CLI on macOS (add, search, list inbox/today/upcoming)."
metadata: { "klaus": { "emoji": "✅", "os": ["darwin"], "requires": { "bins": ["things"] }, "install": [{ "id": "go", "kind": "go", "module": "github.com/ossianhempel/things3-cli/cmd/things@latest", "label": "Install things3-cli (go)" }] } }
---

# Things 3 CLI

Use `things` to read your Things 3 database and add/update todos via URL scheme.

## When to Use

- User mentions Things 3 or Things.app
- Adding tasks, viewing inbox/today/upcoming
- Searching existing tasks or projects

## Setup

```bash
GOBIN=/opt/homebrew/bin go install github.com/ossianhempel/things3-cli/cmd/things@latest
```

Grant Full Disk Access to calling app if DB reads fail.

## Read Commands (Database)

```bash
things inbox --limit 50
things today
things upcoming
things search "query"
things projects
things areas
things tags
```

## Write Commands (URL Scheme)

### Add Todo

```bash
things add "Buy milk"
things add "Call mom" --notes "About dinner" --when today
things add "Book flights" --list "Travel" --deadline 2026-01-02
things add "Pack charger" --list "Travel" --heading "Before"
things add "Call dentist" --tags "health,phone"
things add "Trip prep" --checklist-item "Passport" --checklist-item "Tickets"
```

### Multi-line (title + notes from stdin)

```bash
cat <<'EOF' | things add -
Title line
Notes line 1
Notes line 2
EOF
```

### Update Todo (requires auth token)

```bash
# Get ID
things search "milk" --limit 5

# Update
things update --id <UUID> --auth-token <TOKEN> "New title"
things update --id <UUID> --auth-token <TOKEN> --notes "New notes"
things update --id <UUID> --auth-token <TOKEN> --completed
```

### Preview Before Writing

```bash
things --dry-run add "Title"      # Prints URL, doesn't open Things
```

## Notes

- macOS only, requires Things 3 installed
- Read: directly queries local SQLite database
- Write: uses Things URL scheme (`things://`)
- Delete not supported; use `--completed` or `--canceled` instead
- Set `THINGS_AUTH_TOKEN` env var to avoid passing `--auth-token` each time
