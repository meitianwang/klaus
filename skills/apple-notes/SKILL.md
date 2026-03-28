---
name: apple-notes
description: "Manage Apple Notes via memo CLI on macOS (create, view, search, move, export)."
metadata: { "klaus": { "emoji": "📝", "os": ["darwin"], "requires": { "bins": ["memo"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "antoniorodr/memo/memo", "label": "Install memo (brew)" }] } }
---

# Apple Notes CLI

Use `memo notes` to manage Apple Notes from the terminal.

## When to Use

- User asks to add, search, or list notes
- User mentions Apple Notes or Notes.app
- Managing note folders

## Setup

- Install: `brew install antoniorodr/memo/memo`
- macOS only; grant Automation access to Notes.app when prompted

## Commands

### View Notes

```bash
memo notes                        # List all notes
memo notes -f "Folder Name"      # Filter by folder
memo notes -s "query"            # Search (fuzzy)
```

### Create

```bash
memo notes -a                    # Interactive editor
memo notes -a "Note Title"      # Quick add with title
```

### Edit

```bash
memo notes -e                    # Interactive selection
```

### Delete

```bash
memo notes -d                    # Interactive selection
```

### Move

```bash
memo notes -m                    # Interactive: select note + destination folder
```

### Export

```bash
memo notes -ex                   # Export to HTML/Markdown
```

## Notes

- macOS only, requires Notes.app accessible
- Cannot edit notes containing images/attachments
- Interactive prompts require terminal access
- Grant permissions: System Settings > Privacy & Security > Automation
