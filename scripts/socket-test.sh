#!/usr/bin/env bash
set -euo pipefail

SUBJECT="${1:-Test subject}"
BODY="${2:-Test body}"

ID=$(curl -s -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d "{\"subject\":\"$SUBJECT\",\"body\":\"$BODY\"}" | jq -r .ticketId)

echo "ticketId: $ID"
node --experimental-strip-types --no-warnings test-socket.ts "$ID"
