#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
bun install
bun run build.ts
echo "Engine built → dist/cli.js"
