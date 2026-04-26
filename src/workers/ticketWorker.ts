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
import { triageTicket, draftResolution, ZodValidationError, Phase1Schema, type Phase1Output } from '../adapters/aiAdapter.js';
import { emitTicketStarted, emitTicketProgress, emitTicketCompleted, emitTicketFailed } from '../sockets/emitter.js';
import { z } from 'zod';

if (!process.env['SQS_QUEUE_URL']) throw new Error('SQS_QUEUE_URL is not set');
if (!process.env['SQS_DLQ_URL']) throw new Error('SQS_DLQ_URL is not set');

const QUEUE_URL = process.env['SQS_QUEUE_URL'];
const DLQ_URL = process.env['SQS_DLQ_URL'];

const WORKER_CONFIG = {
  maxAttempts: 3,
  pollWaitSeconds: 20,
  shutdownTimeoutMs: 60_000,
  sqsMaxDelaySeconds: 900,
} as const;

function calculateBackoffSeconds(attempts: number): number {
  const jitterMs = Math.floor(Math.random() * 500);
  const delayMs = Math.pow(2, attempts) * 1000 + jitterMs;
  return Math.min(Math.ceil(delayMs / 1000), WORKER_CONFIG.sqsMaxDelaySeconds);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false;

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current job then stopping');
  isShuttingDown = true;
  setTimeout(() => {
    logger.warn('shutdown timeout reached, forcing exit');
    process.exit(1);
  }, WORKER_CONFIG.shutdownTimeoutMs).unref();
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
  emitTicketFailed(ticketId, `phase ${phase} failed after max attempts`);
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
  phase1Output: Phase1Output | null,
): Promise<void> {
  let phaseRow = await getPhase(ticketId, phase);
  if (!phaseRow) phaseRow = await insertPhase(ticketId, phase);

  if (phaseRow.attempts >= WORKER_CONFIG.maxAttempts) {
    await routeToDLQ(ticketId, phase, receiptHandle);
    return;
  }

  await updatePhaseStatus(ticketId, phase, 'started');
  await insertEvent({ ticketId, phase, eventType: 'phase_started' });
  logger.info({ ticketId, phase }, 'phase started');

  const phaseAttempt = phaseRow.attempts + 1;

  const ticketInput = { id: ticketId, subject: ticket.subject, body: ticket.body };

  try {
    let output: unknown;
    if (phase === 'phase1') {
      output = await triageTicket(ticketInput, phaseAttempt);
    } else {
      if (phase1Output === null) throw new Error('phase2 requires phase1 output');
      output = await draftResolution(ticketInput, phase1Output, phaseAttempt);
    }

    await updatePhaseStatus(ticketId, phase, 'success', output);
    await insertEvent({ ticketId, phase, eventType: 'phase_completed', payload: output });
    logger.info({ ticketId, phase }, 'phase completed');

    if (phase === 'phase1') {
      emitTicketProgress(ticketId);
      await deleteMessage(receiptHandle);
      await requeueTicket(ticketId);
    } else {
      await updateTicketStatus(ticketId, 'completed');
      emitTicketCompleted(ticketId, phase1Output, output);
      await deleteMessage(receiptHandle);
    }
  } catch (err) {
    await updatePhaseStatus(ticketId, phase, 'failure');
    await insertEvent({ ticketId, phase, eventType: 'phase_failed', payload: { error: String(err) } });
    logger.error({ ticketId, phase, err }, 'phase failed');

    // Zod validation failure = bad AI output, retrying same input won't help
    if (err instanceof ZodValidationError) {
      await routeToDLQ(ticketId, phase, receiptHandle);
      return;
    }

    const updated = await getPhase(ticketId, phase);
    const attempts = updated?.attempts ?? WORKER_CONFIG.maxAttempts;

    if (attempts >= WORKER_CONFIG.maxAttempts) {
      await routeToDLQ(ticketId, phase, receiptHandle);
    } else {
      const delaySecs = calculateBackoffSeconds(attempts);
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

const MessageSchema = z.object({ ticketId: z.string().uuid() });

async function processMessage(body: string, receiptHandle: string): Promise<void> {
  const parsed = MessageSchema.safeParse(JSON.parse(body));

  if (!parsed.success) {
    logger.warn({ body }, 'malformed message, discarding');
    await deleteMessage(receiptHandle);
    return;
  }

  const { ticketId } = parsed.data;

  const ticket = await getTicketById(ticketId);
  if (!ticket) {
    logger.warn({ ticketId }, 'ticket not found, discarding message');
    await deleteMessage(receiptHandle);
    return;
  }

  await updateTicketStatus(ticketId, 'processing');
  emitTicketStarted(ticketId);

  const phase1 = await getPhase(ticketId, 'phase1');
  const phase2 = await getPhase(ticketId, 'phase2');

  if (!phase1 || phase1.status !== 'success') {
    await runPhase(ticketId, 'phase1', receiptHandle, ticket, null);
    return;
  }

  if (!phase2 || phase2.status !== 'success') {
    const p1out = Phase1Schema.safeParse(phase1.output);
    if (!p1out.success) {
      logger.error({ ticketId }, 'phase1 output in DB failed schema validation, routing to DLQ');
      await routeToDLQ(ticketId, 'phase2', receiptHandle);
      return;
    }
    await runPhase(ticketId, 'phase2', receiptHandle, ticket, p1out.data);
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
          WaitTimeSeconds: WORKER_CONFIG.pollWaitSeconds,
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
