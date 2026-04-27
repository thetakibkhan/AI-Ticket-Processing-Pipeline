#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"
ACCOUNT="000000000000"
QUEUE="ticket-processing-queue"
DLQ="ticket-processing-dlq"

AWS="aws --endpoint-url $ENDPOINT --region $REGION"

echo "Creating DLQ: $DLQ"
$AWS sqs create-queue --queue-name "$DLQ"

DLQ_ARN="arn:aws:sqs:$REGION:$ACCOUNT:$DLQ"

echo "Creating main queue: $QUEUE (redrive -> $DLQ)"
$AWS sqs create-queue \
  --queue-name "$QUEUE" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "Done."
echo "  Main: http://sqs.$REGION.localhost.localstack.cloud:4566/$ACCOUNT/$QUEUE"
echo "  DLQ:  http://sqs.$REGION.localhost.localstack.cloud:4566/$ACCOUNT/$DLQ"
