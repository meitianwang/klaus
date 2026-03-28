---
name: openai-whisper
description: "Local speech-to-text with OpenAI Whisper CLI (no API key needed)."
metadata: { "klaus": { "emoji": "🎤", "requires": { "bins": ["whisper"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "openai-whisper", "label": "Install Whisper (brew)" }] } }
---

# Whisper (Local CLI)

Transcribe audio locally using OpenAI Whisper. No API key needed.

## When to Use

- User sends an audio file and wants a transcript
- User asks to transcribe a recording
- Speech-to-text without cloud API

## Commands

```bash
# Basic transcription
whisper /path/audio.mp3 --model medium --output_format txt --output_dir .

# Translate to English
whisper /path/audio.m4a --task translate --output_format srt

# Specific language
whisper /path/audio.wav --language zh --output_format txt --output_dir .
```

## Models

| Model | Speed | Accuracy | VRAM |
|-------|-------|----------|------|
| tiny | Fastest | Low | ~1GB |
| base | Fast | Fair | ~1GB |
| small | Medium | Good | ~2GB |
| medium | Slow | Better | ~5GB |
| large | Slowest | Best | ~10GB |
| turbo | Fast | Good | ~6GB |

Default: `turbo`

## Output Formats

`txt`, `srt`, `vtt`, `json`, `tsv`

## Notes

- Models download to `~/.cache/whisper` on first run
- Use smaller models for speed, larger for accuracy
- GPU acceleration automatic if available (CUDA/Metal)
