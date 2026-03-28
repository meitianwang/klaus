---
name: apple-reminders
description: "Manage Apple Reminders via remindctl CLI (list, add, complete, delete). Syncs to iPhone/iPad."
metadata: { "klaus": { "emoji": "⏰", "os": ["darwin"], "requires": { "bins": ["remindctl"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/remindctl", "label": "Install remindctl (brew)" }] } }
---

# Apple Reminders CLI (remindctl)

Use `remindctl` to manage Apple Reminders from the terminal. Syncs to iPhone/iPad.

## When to Use

- User mentions "reminder" or "Reminders app"
- Creating personal to-dos with due dates
- Managing Apple Reminders lists
- Tasks that should appear on iPhone/iPad

## When NOT to Use

- Scheduling Klaus agent tasks → use cron-manager skill
- Calendar events → use Apple Calendar
- One-time alerts → use cron-manager skill

## Setup

```bash
brew install steipete/tap/remindctl
remindctl status      # Check access
remindctl authorize   # Request permission
```

## Commands

### View Reminders

```bash
remindctl                        # Today's reminders
remindctl today
remindctl tomorrow
remindctl week                   # This week
remindctl overdue                # Past due
remindctl all                    # Everything
remindctl 2026-01-04             # Specific date
```

### Manage Lists

```bash
remindctl list                   # Show all lists
remindctl list Work              # Specific list
remindctl list Projects --create # Create list
remindctl list Work --delete     # Delete list
```

### Create Reminders

```bash
remindctl add "Buy milk"
remindctl add --title "Call mom" --list Personal --due tomorrow
remindctl add --title "Meeting prep" --due "2026-02-15 09:00"
```

### Complete/Delete

```bash
remindctl complete 1 2 3        # Complete by ID
remindctl delete 4A83 --force   # Delete by ID
```

### Output Formats

```bash
remindctl today --json           # JSON
remindctl today --plain          # TSV
remindctl today --quiet          # Counts only
```

## Date Formats

`today`, `tomorrow`, `yesterday`, `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, ISO 8601

## Notes

- macOS only, syncs via iCloud to all Apple devices
- Always clarify: Apple Reminders vs Klaus agent alert (cron-manager)
