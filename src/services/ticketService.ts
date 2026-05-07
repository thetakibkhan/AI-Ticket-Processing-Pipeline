import type { PoolClient } from 'pg';
import pool from '../lib/db.js';
import { insertTicket, lockTicketForReplay, setTicketQueued, updateTicketStatus, type Ticket, type LockResult } from '../repositories/ticketRepo.js';
import { resetFailedPhases } from '../repositories/phaseRepo.js';
import { insertEvent } from '../repositories/eventRepo.js';
import { sendMessage } from '../queues/producer.js';
import logger from '../lib/logger.js';

const MAX_SQS_RETRIES = 3;

type ReplayResult = {
  ticketId: string;
  status: 'queued';
};

export class ReplayTicketError extends Error {
  constructor(
    public readonly kind: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'ReplayTicketError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function retryEnqueue(ticketId: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SQS_RETRIES; attempt++) {
    const delayMs = Math.pow(2, attempt - 1) * 500;
    await sleep(delayMs);
    try {
      await sendMessage(ticketId);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_SQS_RETRIES) {
        logger.error({ ticketId, attempt, err }, 'sqs enqueue failed after max retries — manual replay required');
      } else {
        logger.warn({ ticketId, attempt, delayMs }, 'sqs enqueue retry failed, will retry');
      }
    }
  }
  try {
    await updateTicketStatus(ticketId, 'failed');
    await insertEvent({ ticketId, eventType: 'enqueue_failed', payload: { error: String(lastErr), attempts: MAX_SQS_RETRIES } });
  } catch (err) {
    logger.error({ ticketId, err }, 'failed to record enqueue failure — ticket may be stuck as queued');
  }
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
  const ticket = await insertTicket({ subject, body });
  await enqueueTicket(ticket.id);
  return ticket;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function replayTicket(ticketId: string): Promise<ReplayResult> {
  const replayedPhases = await withTransaction(async client => {
    const lock: LockResult = await lockTicketForReplay(client, ticketId);
    if (!lock.ok) {
      const message = lock.reason === 'not_found' ? 'Ticket not found' : 'Only failed tickets can be replayed';
      throw new ReplayTicketError(lock.reason, message);
    }

    const phases = await resetFailedPhases(client, ticketId);

    await setTicketQueued(client, ticketId);

    for (const phase of phases) {
      await insertEvent({ ticketId, phase, eventType: 'manual_retry_triggered', payload: { source: 'manual_replay' } }, client);
    }

    return phases;
  });

  // Enqueue after DB commit so checkpoint reset is durable before worker pickup.
  await enqueueTicket(ticketId);
  logger.info({ ticketId, replayedPhases }, 'ticket replay enqueued');

  return { ticketId, status: 'queued' };
}
