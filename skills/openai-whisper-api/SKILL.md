---
name: openai-whisper-api
description: "Transcribe audio via OpenAI Whisper API (cloud, fast, requires API key)."
metadata: { "klaus": { "emoji": "🌐", "primaryEnv": "OPENAI_API_KEY", "requires": { "env": ["OPENAI_API_KEY"] } } }
---

# OpenAI Whisper API

Transcribe audio via OpenAI's cloud API. Fast, accurate, requires API key.

## When to Use

- User sends audio and wants fast cloud transcription
- Local Whisper is too slow or not installed
- User explicitly asks for OpenAI transcription

## Transcribe

```bash
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@/path/to/audio.m4a" \
  -F model="whisper-1" \
  -F response_format="text"
```

## Options

| Parameter | Values |
|-----------|--------|
| `model` | `whisper-1` |
| `response_format` | `text`, `json`, `srt`, `vtt`, `verbose_json` |
| `language` | ISO-639-1 code (e.g., `en`, `zh`, `ja`) |
| `prompt` | Context hint (e.g., speaker names) |

## With Language Hint

```bash
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@/path/to/audio.mp3" \
  -F model="whisper-1" \
  -F language="en" \
  -F prompt="Speaker names: Alice, Bob" \
  -F response_format="verbose_json"
```

## Notes

- Max file size: 25MB
- Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
- Pricing: $0.006/minute
- For longer files, split first with ffmpeg
