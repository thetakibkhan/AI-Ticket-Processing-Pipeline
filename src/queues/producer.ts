import { SendMessageCommand } from '@aws-sdk/client-sqs';
import sqs from '../lib/sqs.js';
import logger from '../lib/logger.js';

if (!process.env['SQS_QUEUE_URL']) {
  throw new Error('SQS_QUEUE_URL is not set');
}

const QUEUE_URL = process.env['SQS_QUEUE_URL'];

export async function sendMessage(ticketId: string): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({ ticketId }),
  });

  try {
    await sqs.send(command);
    logger.info({ ticketId }, 'ticket enqueued');
  } catch (err) {
    logger.error({ ticketId, err }, 'failed to enqueue ticket');
    throw err;
  }
}
