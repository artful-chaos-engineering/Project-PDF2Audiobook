#!/usr/bin/env bash
# Copyright (c) 2026 Mark Vriesenga
# SPDX-License-Identifier: MIT
# Licensed under the MIT License. See the LICENSE file in the project root.

set -euo pipefail

cd "$(dirname "$0")"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

if [ "${1:-}" = "--stop" ]; then
  pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN || true)"
  if [ -n "$pids" ]; then
    kill $pids
    echo "Stopped server on port ${PORT}"
  else
    echo "Nothing listening on port ${PORT}"
  fi
  exit 0
fi

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi


command -v npx >/dev/null || { echo "ERROR: npx not found. Install Node.js." >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found. Install it (brew install ffmpeg)." >&2; exit 1; }

old="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN || true)"
if [ -n "$old" ]; then
  kill $old
  sleep 1
fi

PORT="$PORT" npx tsx src/webapp.ts &
server_pid=$!

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "$URL/"; then break; fi
  sleep 1
done
curl -fsS -o /dev/null "$URL/" || { echo "ERROR: server did not start on ${URL}" >&2; kill "$server_pid" 2>/dev/null; exit 1; }

open -a "Brave Browser" "$URL" 2>/dev/null || open -a "Google Chrome" "$URL" 2>/dev/null || open -a "Firefox" "$URL" 2>/dev/null || echo "No browser found; open $URL manually"
echo "Running at ${URL} (stop with: ./run_webapp.sh --stop)"
wait "$server_pid"
