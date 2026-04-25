import 'dotenv/config';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import sqs from '../lib/sqs.js';
import logger from '../lib/logger.js';
import { getTicketById, updateTicketStatus } from '../repositories/ticketRepo.js';
import { getPhase, insertPhase, updatePhaseStatus, type PhaseType } from '../repositories/phaseRepo.js';
import { insertEvent } from '../repositories/eventRepo.js';

if (!process.env['SQS_QUEUE_URL']) throw new Error('SQS_QUEUE_URL is not set');
if (!process.env['SQS_DLQ_URL']) throw new Error('SQS_DLQ_URL is not set');

const QUEUE_URL = process.env['SQS_QUEUE_URL'];
const DLQ_URL = process.env['SQS_DLQ_URL'];
const MAX_ATTEMPTS = 3;

// ─── Phase stubs (replaced by real AI in Epic 4) ─────────────────────────────

async function runPhase1(ticket: { subject: string; body: string }): Promise<unknown> {
  await new Promise(r => setTimeout(r, 100));
  return {
    category: 'Technical',
    priority: 'High',
    sentiment: 'Neutral',
    escalation: false,
    routing: 'engineering',
    summary: ticket.subject,
  };
}

async function runPhase2(
  ticket: { subject: string; body: string },
  _phase1Output: unknown,
): Promise<unknown> {
  await new Promise(r => setTimeout(r, 100));
  return {
    customerReply: 'Thank you for reaching out. We are looking into your issue.',
    internalNote: 'Reviewed by AI triage system.',
    nextActions: ['Assign to engineering team'],
  };
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false;

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current job then stopping');
  isShuttingDown = true;
  setTimeout(() => {
    logger.warn('shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 60_000).unref();
});

// ─── SQS helpers ─────────────────────────────────────────────────────────────

async function deleteMessage(receiptHandle: string): Promise<void> {
  await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: receiptHandle }));
}

async function requeueTicket(ticketId: string, delaySecs = 0): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ ticketId }),
      DelaySeconds: delaySecs,
    }),
  );
}

async function routeToDLQ(ticketId: string, phase: PhaseType, receiptHandle: string): Promise<void> {
  logger.warn({ ticketId, phase }, 'max attempts reached, routing to DLQ');
  await updateTicketStatus(ticketId, 'failed');
  await insertEvent({ ticketId, phase, eventType: 'dlq_routed' });
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: DLQ_URL,
      MessageBody: JSON.stringify({ ticketId, failedPhase: phase }),
    }),
  );
  await deleteMessage(receiptHandle);
}

// ─── Phase orchestration ──────────────────────────────────────────────────────

async function runPhase(
  ticketId: string,
  phase: PhaseType,
  receiptHandle: string,
  ticket: { subject: string; body: string },
  phase1Output: unknown,
): Promise<void> {
  let phaseRow = await getPhase(ticketId, phase);
  if (!phaseRow) phaseRow = await insertPhase(ticketId, phase);

  if (phaseRow.attempts >= MAX_ATTEMPTS) {
    await routeToDLQ(ticketId, phase, receiptHandle);
    return;
  }

  await updatePhaseStatus(ticketId, phase, 'started');
  await insertEvent({ ticketId, phase, eventType: 'phase_started' });
  logger.info({ ticketId, phase }, 'phase started');

  try {
    const output =
      phase === 'phase1' ? await runPhase1(ticket) : await runPhase2(ticket, phase1Output);

    await updatePhaseStatus(ticketId, phase, 'success', output);
    await insertEvent({ ticketId, phase, eventType: 'phase_completed', payload: output });
    logger.info({ ticketId, phase }, 'phase completed');

    if (phase === 'phase1') {
      await deleteMessage(receiptHandle);
      await requeueTicket(ticketId);
    } else {
      await updateTicketStatus(ticketId, 'completed');
      await deleteMessage(receiptHandle);
    }
  } catch (err) {
    await updatePhaseStatus(ticketId, phase, 'failure');
    await insertEvent({ ticketId, phase, eventType: 'phase_failed', payload: { error: String(err) } });
    logger.error({ ticketId, phase, err }, 'phase failed');

    const updated = await getPhase(ticketId, phase);
    const attempts = updated?.attempts ?? MAX_ATTEMPTS;

    if (attempts >= MAX_ATTEMPTS) {
      await routeToDLQ(ticketId, phase, receiptHandle);
    } else {
      const delayMs = Math.pow(2, attempts) * 1000 + Math.floor(Math.random() * 500);
      const delaySecs = Math.min(Math.ceil(delayMs / 1000), 900);
      logger.info({ ticketId, phase, attempts, delaySecs }, 'retry scheduled');
      await insertEvent({
        ticketId,
        phase,
        eventType: 'retry_scheduled',
        payload: { attempt: attempts, delaySecs },
      });
      await requeueTicket(ticketId, delaySecs);
      await deleteMessage(receiptHandle);
    }
  }
}

// ─── Message processor ────────────────────────────────────────────────────────

export async function processMessageForTest(body: string, receiptHandle: string): Promise<void> {
  return processMessage(body, receiptHandle);
}

async function processMessage(body: string, receiptHandle: string): Promise<void> {
  const parsed = JSON.parse(body) as { ticketId?: string };
  const ticketId = parsed.ticketId;

  if (!ticketId) {
    logger.warn({ body }, 'malformed message, discarding');
    await deleteMessage(receiptHandle);
    return;
  }

  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    logger.warn({ ticketId }, 'ticket not found, discarding message');
    await deleteMessage(receiptHandle);
    return;
  }

  await updateTicketStatus(ticketId, 'processing');

  const phase1 = await getPhase(ticketId, 'phase1');
  const phase2 = await getPhase(ticketId, 'phase2');

  if (!phase1 || phase1.status !== 'success') {
    await runPhase(ticketId, 'phase1', receiptHandle, ticket, null);
    return;
  }

  if (!phase2 || phase2.status !== 'success') {
    await runPhase(ticketId, 'phase2', receiptHandle, ticket, phase1.output);
    return;
  }

  // Both phases already complete — duplicate message, just clean up
  await updateTicketStatus(ticketId, 'completed');
  await deleteMessage(receiptHandle);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  logger.info('worker started, polling SQS');

  while (!isShuttingDown) {
    try {
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: QUEUE_URL,
          WaitTimeSeconds: 20,
          MaxNumberOfMessages: 1,
        }),
      );

      const messages = result.Messages ?? [];
      if (messages.length === 0) continue;

      const msg = messages[0]!;
      if (!msg.Body || !msg.ReceiptHandle) continue;

      await processMessage(msg.Body, msg.ReceiptHandle);
    } catch (err) {
      logger.error({ err }, 'poll error, retrying');
    }
  }

  logger.info('worker stopped');
  process.exit(0);
}

// Only start the poll loop when run directly, not when imported by tests
if (process.env['NODE_ENV'] !== 'test') {
  poll();
}
