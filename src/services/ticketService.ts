import { insertTicket, type Ticket } from '../repositories/ticketRepo.js';
import { sendMessage } from '../queues/producer.js';
import logger from '../lib/logger.js';

const MAX_SQS_RETRIES = 3;

async function enqueueWithRetry(ticketId: string, attempt = 1): Promise<void> {
  try {
    await sendMessage(ticketId);
  } catch (err) {
    if (attempt < MAX_SQS_RETRIES) {
      const delay = Math.pow(2, attempt) * 500;
      logger.warn({ ticketId, attempt, delay }, 'sqs enqueue failed, retrying');
      setTimeout(() => void enqueueWithRetry(ticketId, attempt + 1), delay);
    } else {
      logger.error({ ticketId, attempt, err }, 'sqs enqueue failed after max retries — manual replay required');
    }
  }
}

export async function createTicket(subject: string, body: string): Promise<Ticket> {
  const ticket = await insertTicket({ subject, body });

  try {
    await sendMessage(ticket.id);
  } catch (err) {
    logger.warn({ ticketId: ticket.id, err }, 'initial sqs enqueue failed, starting background retry');
    setTimeout(() => void enqueueWithRetry(ticket.id, 2), 500);
  }

  return ticket;
}
