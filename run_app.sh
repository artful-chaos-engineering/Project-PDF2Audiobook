#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

for key in ANTHROPIC_API_KEY ELEVENLABS_API_KEY; do
  if [ -z "${!key:-}" ]; then
    echo "ERROR: $key is not set. Add it to $(pwd)/.env" >&2
    exit 1
  fi
done

command -v npx >/dev/null || { echo "ERROR: npx not found. Install Node.js." >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found. Install it (brew install ffmpeg)." >&2; exit 1; }

exec npx tsx src/generate-with-elevenlabs.ts
