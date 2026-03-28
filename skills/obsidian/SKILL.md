---
name: obsidian
description: "Work with Obsidian vaults (plain Markdown notes) via obsidian-cli."
metadata: { "klaus": { "emoji": "💎", "requires": { "bins": ["obsidian-cli"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "yakitrak/yakitrak/obsidian-cli", "label": "Install obsidian-cli (brew)" }] } }
---

# Obsidian

Work with Obsidian vaults — plain Markdown notes on disk.

## When to Use

- User asks to create, search, or organize notes
- User references their Obsidian vault
- User wants to move/rename notes with wikilink updates

## Vault Structure

- Notes: `*.md` (plain Markdown)
- Config: `.obsidian/` (don't touch from scripts)
- Canvases: `*.canvas` (JSON)
- Attachments: images/PDFs in configured folder

## Find Active Vault

Obsidian tracks vaults in:
`~/Library/Application Support/obsidian/obsidian.json`

```bash
# If default vault is set:
obsidian-cli print-default --path-only

# Otherwise read the config file and use the vault with "open": true
```

Multiple vaults are common (iCloud, Documents, work/personal). Don't guess; read the config.

## Commands

### Set Default Vault

```bash
obsidian-cli set-default "vault-name"
obsidian-cli print-default
```

### Search

```bash
# Search note names
obsidian-cli search "query"

# Search inside notes (content + line numbers)
obsidian-cli search-content "query"
```

### Create

```bash
obsidian-cli create "Folder/New note" --content "..." --open
```

### Move/Rename (Safe Refactor)

```bash
# Updates [[wikilinks]] across the vault automatically
obsidian-cli move "old/path/note" "new/path/note"
```

### Delete

```bash
obsidian-cli delete "path/note"
```

## Notes

- Prefer direct `.md` file edits when appropriate; Obsidian picks up changes
- `obsidian-cli move` is preferred over `mv` because it updates internal links
- Avoid creating notes in hidden dot-folders (`.something/`)
- macOS only (reads Obsidian's app support directory)
