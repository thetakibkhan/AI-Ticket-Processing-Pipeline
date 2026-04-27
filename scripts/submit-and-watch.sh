#!/usr/bin/env bash
set -euo pipefail

SUBJECT="${1:-}"
BODY="${2:-}"

if [[ -z "$SUBJECT" || -z "$BODY" ]]; then
  echo "Usage: ./scripts/submit-and-watch.sh <subject> <body>"
  exit 1
fi

echo "watching socket events..."
node --experimental-strip-types --no-warnings "$(dirname "$0")/../test-socket.ts" --create "$SUBJECT" "$BODY"
