---
name: gog
description: "Google Workspace CLI — Gmail, Calendar, Drive, Contacts, Sheets, Docs."
metadata: { "klaus": { "emoji": "📫", "requires": { "bins": ["gog"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/gog", "label": "Install gog (brew)" }] } }
---

# gog — Google Workspace CLI

Manage Gmail, Calendar, Drive, Contacts, Sheets, and Docs from the terminal.

## When to Use

- User asks to check/send email (Gmail)
- Calendar events (create, list, check availability)
- Google Drive file operations
- Google Sheets data
- Google Contacts lookup

## Setup

```bash
brew install steipete/tap/gog

# Authenticate (opens browser)
gog auth login
gog auth status
```

## Gmail

```bash
gog gmail list                            # Inbox
gog gmail list --label SENT --max 10      # Sent mail
gog gmail read <id>                       # Read message
gog gmail send --to "a@b.com" --subject "Hi" --body "Hello"
gog gmail search "from:boss subject:urgent"
gog gmail reply <id> --body "Got it"
gog gmail trash <id>
```

## Calendar

```bash
gog calendar list                         # Today's events
gog calendar list --days 7                # Next 7 days
gog calendar add --title "Meeting" --start "2026-03-29 14:00" --end "2026-03-29 15:00"
gog calendar add --title "Lunch" --start tomorrow --duration 1h
gog calendar delete <id>
```

## Drive

```bash
gog drive list                            # Root files
gog drive list --folder "Work"            # Folder contents
gog drive search "quarterly report"
gog drive download <id> --output ./file.pdf
gog drive upload ./report.pdf --folder "Reports"
```

## Sheets

```bash
gog sheets read <spreadsheet-id>          # Read all
gog sheets read <id> --range "A1:D10"     # Specific range
gog sheets write <id> --range "A1" --values '[["Name","Score"],["Alice","95"]]'
gog sheets append <id> --values '[["Bob","88"]]'
```

## Contacts

```bash
gog contacts list --max 20
gog contacts search "John"
gog contacts show <id>
```

## SECURITY — CRITICAL

- Never print or log OAuth tokens
- Confirm recipients before sending emails
- Don't delete files/events without user confirmation

## Notes

- Requires Google account OAuth (browser-based login)
- All commands support `--json` for structured output
- Rate limits apply (Google Workspace quotas)
