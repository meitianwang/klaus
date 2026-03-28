---
name: gifgrep
description: "Search GIF providers (Tenor/Giphy), download, and extract stills/sheets."
metadata: { "klaus": { "emoji": "🧲", "requires": { "bins": ["gifgrep"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/gifgrep", "label": "Install gifgrep (brew)" }, { "id": "go", "kind": "go", "module": "github.com/steipete/gifgrep/cmd/gifgrep@latest", "label": "Install gifgrep (go)" }] } }
---

# gifgrep

Search GIFs from Tenor/Giphy, download, and extract stills or sheets.

## When to Use

- User asks for a GIF or reaction image
- Searching for specific GIF content
- Creating still frames or contact sheets from GIFs

## Commands

### Search

```bash
gifgrep cats --max 5
gifgrep "office handshake" --max 3
gifgrep cats --format url | head -n 5
gifgrep search --json cats | jq '.[0].url'
```

### Download

```bash
gifgrep cats --download --max 1          # Save to ~/Downloads
gifgrep cats --download --max 1 --reveal # Open in Finder
```

### Extract Stills & Sheets

```bash
# Single frame
gifgrep still ./clip.gif --at 1.5s -o still.png

# Contact sheet (grid of frames)
gifgrep sheet ./clip.gif --frames 9 --cols 3 -o sheet.png
```

### TUI Browser

```bash
gifgrep tui "query"    # Interactive browser (Kitty/Ghostty for previews)
```

## Providers

```bash
gifgrep --source tenor cats       # Default
gifgrep --source giphy cats       # Requires GIPHY_API_KEY
gifgrep --source auto cats        # Try both
```

## Output

- `--json` — Array of `{id, title, url, preview_url, tags, width, height}`
- `--format url` — One URL per line (pipe-friendly)

## Notes

- Tenor works without API key (demo key)
- Giphy requires `GIPHY_API_KEY`
- Sheets are great for quick review: single PNG grid of sampled frames
