#!/usr/bin/env bash
set -euo pipefail

SUBJECT="${1:-}"
BODY="${2:-}"

if [[ -z "$SUBJECT" || -z "$BODY" ]]; then
  echo "Usage: ./scripts/submit.sh <subject> <body>"
  exit 1
fi

curl -s -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d "{\"subject\":\"$SUBJECT\",\"body\":\"$BODY\"}" | jq .
