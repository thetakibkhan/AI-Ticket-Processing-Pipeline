import { insertTicket, type Ticket } from '../repositories/ticketRepo.js';
import { sendMessage } from '../queues/producer.js';
import logger from '../lib/logger.js';

const MAX_SQS_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function retryEnqueue(ticketId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SQS_RETRIES; attempt++) {
    const delayMs = Math.pow(2, attempt - 1) * 500;
    await sleep(delayMs);
    try {
      await sendMessage(ticketId);
      return;
    } catch (err) {
      if (attempt >= MAX_SQS_RETRIES) {
        logger.error({ ticketId, attempt, err }, 'sqs enqueue failed after max retries — manual replay required');
      } else {
        logger.warn({ ticketId, attempt, delayMs }, 'sqs enqueue retry failed, will retry');
      }
    }
  }
}

export async function createTicketRecord(subject: string, body: string): Promise<Ticket> {
  return insertTicket({ subject, body });
}

export async function enqueueTicket(ticketId: string): Promise<void> {
  try {
    await sendMessage(ticketId);
  } catch (err) {
    logger.warn({ ticketId, err }, 'initial sqs enqueue failed, starting background retries');
    void retryEnqueue(ticketId);
  }
}

export async function createTicket(subject: string, body: string): Promise<Ticket> {
  const ticket = await createTicketRecord(subject, body);
  await enqueueTicket(ticket.id);
  return ticket;
}
