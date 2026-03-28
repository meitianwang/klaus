---
name: sag
description: "ElevenLabs text-to-speech with mac-style say UX."
metadata: { "klaus": { "emoji": "🔊", "primaryEnv": "ELEVENLABS_API_KEY", "requires": { "bins": ["sag"], "env": ["ELEVENLABS_API_KEY"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/sag", "label": "Install sag (brew)" }] } }
---

# sag — ElevenLabs TTS

Text-to-speech via ElevenLabs with local playback.

## When to Use

- User asks to read text aloud or generate audio
- User wants a voice reply
- Creating audio content from text

## Quick Start

```bash
sag "Hello there"
sag speak -v "Roger" "Hello"
sag voices                    # List available voices
```

## Commands

```bash
# Speak text
sag "Text to speak"

# Choose voice
sag speak -v "Roger" "Hello from Roger"

# Save to file
sag -o /tmp/output.mp3 "Text to save as audio"

# List voices
sag voices
```

## Models

| Model | Traits |
|-------|--------|
| `eleven_v3` | Expressive (default) |
| `eleven_multilingual_v2` | Stable, multilingual |
| `eleven_flash_v2_5` | Fast, lower latency |

## v3 Audio Tags

Place at the start of a line for expressiveness:

```bash
sag "[whispers] keep this quiet. [short pause] ok?"
sag "[excited] This is amazing!"
sag "[sings] La la la"
```

Tags: `[whispers]`, `[shouts]`, `[sings]`, `[laughs]`, `[sighs]`, `[sarcastic]`, `[curious]`, `[excited]`, `[crying]`

Pauses: `[pause]`, `[short pause]`, `[long pause]`

## Notes

- Requires `ELEVENLABS_API_KEY`
- Confirm voice + speaker before long output
- Set default voice: `ELEVENLABS_VOICE_ID` env var
