import { SQSClient } from '@aws-sdk/client-sqs';

if (!process.env['SQS_QUEUE_URL']) throw new Error('SQS_QUEUE_URL is not set');
if (!process.env['SQS_DLQ_URL']) throw new Error('SQS_DLQ_URL is not set');

export const QUEUE_URL = process.env['SQS_QUEUE_URL'];
export const DLQ_URL = process.env['SQS_DLQ_URL'];

const sqs = new SQSClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  ...(process.env['SQS_ENDPOINT'] && { endpoint: process.env['SQS_ENDPOINT'] }),
});

export default sqs;
