---
name: summarize
description: "Summarize or extract text from URLs, podcasts, YouTube, and local files."
metadata: { "klaus": { "emoji": "🧾", "requires": { "bins": ["summarize"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/summarize", "label": "Install summarize (brew)" }] } }
---

# Summarize

Fast CLI to summarize URLs, local files, and YouTube links.

## When to Use

- "What's this link/video about?"
- "Summarize this URL/article"
- "Transcribe this YouTube video"
- User shares a URL and wants a summary

## Quick Start

```bash
summarize "https://example.com" --model google/gemini-3-flash-preview
summarize "/path/to/file.pdf" --model google/gemini-3-flash-preview
summarize "https://youtu.be/VIDEO_ID" --youtube auto
```

## YouTube

```bash
# Summary
summarize "https://youtu.be/VIDEO_ID" --youtube auto

# Transcript only (no summary)
summarize "https://youtu.be/VIDEO_ID" --youtube auto --extract-only
```

If the transcript is huge, return a summary first, then ask which section to expand.

## Model + Keys

Set the API key for your chosen provider:

| Provider | Env Var |
|----------|---------|
| Google | `GEMINI_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| xAI | `XAI_API_KEY` |

Default model: `google/gemini-3-flash-preview`

## Useful Flags

| Flag | Purpose |
|------|---------|
| `--length short\|medium\|long\|xl` | Output length |
| `--extract-only` | Extract text only (no summary) |
| `--json` | Machine-readable output |
| `--firecrawl auto` | Fallback extraction for blocked sites |
| `--youtube auto` | YouTube transcript extraction |

## Config

Optional: `~/.summarize/config.json`

```json
{ "model": "openai/gpt-5.2" }
```

## Notes

- No API key needed for extraction; keys required for summarization
- Optional: `FIRECRAWL_API_KEY` for blocked sites
- Optional: `APIFY_API_TOKEN` for YouTube fallback
