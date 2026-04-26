import { SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  ...(process.env['SQS_ENDPOINT'] && { endpoint: process.env['SQS_ENDPOINT'] }),
});

export default sqs;
