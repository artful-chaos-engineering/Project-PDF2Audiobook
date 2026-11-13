#!/usr/bin/env bash
# Copyright (c) 2026 Mark Vriesenga
# SPDX-License-Identifier: MIT
# Licensed under the MIT License. See the LICENSE file in the project root.

set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<USAGE
Usage: ./run_app.sh [--mode MODE] [--input DIR] [--output DIR]
       ./run_app.sh MODE

Options:
  -m, --mode MODE     narration, podcast, debate, summary, or technical-/managerial- plus
                      podcast, debate, deep-dive or summary (default: narration)
  -i, --input DIR     folder with PDFs to convert (default: ./input)
  -o, --output DIR    folder for the MP3 files (default: ./output)
  -h, --help          show this help

Environment: AUDIOBOOK_MODE, AUDIOBOOK_INPUT_DIR and AUDIOBOOK_OUTPUT_DIR set the same values.
Command-line options take precedence over the environment.
USAGE
}

mode="${AUDIOBOOK_MODE:-}"
input_dir="${AUDIOBOOK_INPUT_DIR:-}"
output_dir="${AUDIOBOOK_OUTPUT_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    -m|--mode)   [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; exit 2; }; mode="$2"; shift 2 ;;
    -i|--input)  [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; exit 2; }; input_dir="$2"; shift 2 ;;
    -o|--output) [ $# -ge 2 ] || { echo "ERROR: $1 needs a value" >&2; exit 2; }; output_dir="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    -*) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) mode="$1"; shift ;;
  esac
done

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

[ -n "$mode" ] && export AUDIOBOOK_MODE="$mode"
[ -n "$input_dir" ] && export AUDIOBOOK_INPUT_DIR="$input_dir"
[ -n "$output_dir" ] && export AUDIOBOOK_OUTPUT_DIR="$output_dir"


command -v npx >/dev/null || { echo "ERROR: npx not found. Install Node.js." >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found. Install it (brew install ffmpeg)." >&2; exit 1; }

exec npx tsx src/generate-with-elevenlabs.ts
