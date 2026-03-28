---
name: peekaboo
description: "Capture and automate macOS UI — screenshots, clicks, typing, window/app management."
metadata: { "klaus": { "emoji": "👀", "os": ["darwin"], "requires": { "bins": ["peekaboo"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/peekaboo", "label": "Install Peekaboo (brew)" }] } }
---

# Peekaboo

macOS UI automation CLI: capture screens, click elements, type text, manage apps/windows.

## When to Use

- User wants screenshots or screen analysis
- Automating UI interactions (click, type, drag)
- App/window management (launch, quit, resize, focus)
- Menu bar and Dock operations

## Setup

```bash
brew install steipete/tap/peekaboo
peekaboo permissions    # Check Screen Recording + Accessibility
```

## Core Workflow: See → Click → Type

```bash
# 1. Capture annotated screenshot (identifies UI elements as B1, B2, T1, etc.)
peekaboo see --app Safari --annotate --path /tmp/see.png

# 2. Click an identified element
peekaboo click --on B3 --app Safari

# 3. Type text
peekaboo type "user@example.com" --app Safari
```

## Commands

### Capture & Vision

```bash
peekaboo image --mode screen --path /tmp/screen.png
peekaboo image --app Safari --analyze "Summarize KPIs"
peekaboo see --annotate --path /tmp/ui.png
```

### Interaction

```bash
peekaboo click --on B1                         # Click element by ID
peekaboo click --coords 500,300                # Click coordinates
peekaboo type "Hello" --return                 # Type + Enter
peekaboo hotkey --keys "cmd,shift,t"           # Keyboard shortcut
peekaboo press tab --count 2                   # Press key
peekaboo scroll --direction down --amount 6    # Scroll
peekaboo drag --from B1 --to T2               # Drag & drop
```

### App & Window Management

```bash
peekaboo app launch "Safari" --open https://example.com
peekaboo app quit --app Safari
peekaboo window focus --app Safari
peekaboo window set-bounds --app Safari --x 50 --y 50 --width 1200 --height 800
peekaboo list apps --json
peekaboo list windows --app Safari --json
```

### Menu & Dock

```bash
peekaboo menu click --app Safari --item "New Window"
peekaboo menu click --app TextEdit --path "Format > Font > Show Fonts"
peekaboo dock launch Safari
peekaboo menubar list --json
```

## Targeting Parameters

| Flag | Purpose |
|------|---------|
| `--app` | Target by app name |
| `--on` / `--id` | Element ID from `see` |
| `--coords x,y` | Screen coordinates |
| `--window-title` | Target specific window |
| `--window-id` | Window by numeric ID |

## Notes

- Requires Screen Recording + Accessibility permissions
- Always use `see --annotate` first to identify UI targets before clicking
- Use `--json` for scripted workflows
- macOS only
