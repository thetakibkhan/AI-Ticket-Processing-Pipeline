import { SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

export default sqs;
