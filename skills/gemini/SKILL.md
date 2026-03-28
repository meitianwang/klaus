---
name: gemini
description: "Google Gemini CLI for one-shot Q&A, summaries, and generation."
metadata: { "klaus": { "emoji": "✨", "requires": { "bins": ["gemini"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "gemini-cli", "label": "Install Gemini CLI (brew)" }] } }
---

# Gemini CLI

Use Gemini in one-shot mode for Q&A, summaries, and content generation.

## When to Use

- User asks to use Gemini specifically
- Need a second opinion from a different AI model
- Google-specific knowledge queries

## Commands

```bash
# Basic query
gemini "Explain quantum computing in simple terms"

# Choose model
gemini --model gemini-2.5-pro "Complex analysis task..."

# JSON output
gemini --output-format json "Return structured data about..."

# List extensions
gemini --list-extensions
```

## Setup

```bash
brew install gemini-cli
# First run: follow the interactive auth flow
gemini "Hello"
```

## Notes

- Auth required on first run (interactive Google login)
- Use one-shot mode (avoid interactive/REPL mode)
- Avoid `--yolo` flag for safety
