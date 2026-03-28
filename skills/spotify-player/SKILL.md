---
name: spotify-player
description: "Terminal Spotify playback and search via spogo CLI."
metadata: { "klaus": { "emoji": "🎵", "requires": { "anyBins": ["spogo", "spotify_player"] }, "install": [{ "id": "brew-spogo", "kind": "brew", "formula": "steipete/tap/spogo", "label": "Install spogo (brew)" }, { "id": "brew-sp", "kind": "brew", "formula": "spotify_player", "label": "Install spotify_player (brew)" }] } }
---

# Spotify Player

Control Spotify from the terminal via `spogo` (preferred) or `spotify_player`.

## When to Use

- User asks to play music or control Spotify
- Searching for songs, albums, artists
- Managing playback (play, pause, skip, volume)

## Setup

Spotify Premium required.

```bash
# spogo: import browser cookies
spogo auth import --browser chrome
```

## Commands (spogo)

```bash
# Search
spogo search track "bohemian rhapsody"
spogo search album "dark side of the moon"
spogo search artist "radiohead"

# Playback
spogo play
spogo pause
spogo next
spogo prev
spogo status

# Devices
spogo device list
spogo device set "MacBook Pro"

# Queue
spogo queue add "spotify:track:xxx"
```

## Commands (spotify_player fallback)

```bash
spotify_player search "query"
spotify_player playback play|pause|next|previous
spotify_player connect
spotify_player like
```

## Notes

- Requires Spotify Premium
- Config: `~/.config/spotify-player/app.toml`
- Either `spogo` or `spotify_player` must be installed
