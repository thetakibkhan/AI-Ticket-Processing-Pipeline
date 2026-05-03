import { SendMessageCommand } from '@aws-sdk/client-sqs';
import sqs, { QUEUE_URL } from '../lib/sqs.js';
import logger from '../lib/logger.js';

export async function sendMessage(ticketId: string, delaySeconds = 0): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({ ticketId }),
    ...(delaySeconds > 0 && { DelaySeconds: delaySeconds }),
  });

  try {
    await sqs.send(command);
    logger.info({ ticketId }, 'ticket enqueued');
  } catch (err) {
    logger.error({ ticketId, err }, 'failed to enqueue ticket');
    throw err;
  }
}
