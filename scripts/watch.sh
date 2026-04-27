#!/usr/bin/env bash
set -euo pipefail

TICKET_ID="${1:-}"

if [[ -z "$TICKET_ID" ]]; then
  echo "Usage: ./scripts/watch.sh <ticketId>"
  exit 1
fi

node --experimental-strip-types --no-warnings "$(dirname "$0")/../test-socket.ts" "$TICKET_ID"
