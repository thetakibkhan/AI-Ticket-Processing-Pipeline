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
import { MessageSchema } from '../schemas/workerSchemas.js';
import { emitTicketStarted, emitTicketProgress, emitTicketCompleted, emitTicketFailed } from '../sockets/emitter.js';

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

// ─── TicketWorker ─────────────────────────────────────────────────────────────

class TicketWorker {
  private isShuttingDown = false;

  constructor() {
    process.on('SIGTERM', () => this.handleShutdown());
  }

  private handleShutdown(): void {
    logger.info('SIGTERM received, finishing current job then stopping');
    this.isShuttingDown = true;
    setTimeout(() => {
      logger.warn('shutdown timeout reached, forcing exit');
      process.exit(1);
    }, WORKER_CONFIG.shutdownTimeoutMs).unref();
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: receiptHandle }));
  }

  private async requeueTicket(ticketId: string, delaySecs = 0): Promise<void> {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ ticketId }),
        DelaySeconds: delaySecs,
      }),
    );
  }

  private async routeToDLQ(ticketId: string, phase: PhaseType, receiptHandle: string): Promise<void> {
    logger.warn({ ticketId, phase }, 'max attempts reached, routing to DLQ');
    await updateTicketStatus(ticketId, 'failed');
    await insertEvent({ ticketId, phase, eventType: 'dlq_routed' });
    emitTicketFailed(ticketId, `phase ${phase} failed after max attempts`);
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: DLQ_URL,
          MessageBody: JSON.stringify({ ticketId, failedPhase: phase }),
        }),
      );
    } catch (err) {
      logger.error({ ticketId, phase, err }, 'DLQ send failed — ticket marked failed but not in DLQ, manual intervention required');
      await insertEvent({ ticketId, phase, eventType: 'dlq_send_failed', payload: { error: String(err) } });
    }
    await this.deleteMessage(receiptHandle);
  }

  private async runPhase(
    ticketId: string,
    phase: PhaseType,
    receiptHandle: string,
    ticket: { subject: string; body: string },
    phase1Output: Phase1Output | null,
  ): Promise<void> {
    let phaseRow = await getPhase(ticketId, phase);
    if (!phaseRow) phaseRow = await insertPhase(ticketId, phase);

    if (phaseRow.attempts >= WORKER_CONFIG.maxAttempts) {
      await this.routeToDLQ(ticketId, phase, receiptHandle);
      return;
    }

    await updatePhaseStatus(ticketId, phase, 'started');
    await insertEvent({ ticketId, phase, eventType: 'phase_started' });
    logger.info({ ticketId, phase }, 'phase started');
    emitTicketStarted(ticketId, phase);

    const phaseAttempt = phaseRow.attempts + 1;
    const ticketInput = { id: ticketId, subject: ticket.subject, body: ticket.body };

    const runAI = async (): Promise<unknown> => {
      if (phase === 'phase1') return triageTicket(ticketInput, phaseAttempt);
      if (phase1Output === null) throw new Error('phase2 requires phase1 output');
      return draftResolution(ticketInput, phase1Output, phaseAttempt);
    };

    try {
      const output = await runAI();

      await updatePhaseStatus(ticketId, phase, 'success', output);
      await insertEvent({ ticketId, phase, eventType: 'phase_completed', payload: output });
      logger.info({ ticketId, phase }, 'phase completed');

      if (phase === 'phase1') {
        emitTicketProgress(ticketId, phase);
        await this.deleteMessage(receiptHandle);
        await this.requeueTicket(ticketId);
      } else {
        await updateTicketStatus(ticketId, 'completed');
        emitTicketCompleted(ticketId, phase1Output, output);
        await this.deleteMessage(receiptHandle);
      }
    } catch (err) {
      await updatePhaseStatus(ticketId, phase, 'failure');
      await insertEvent({ ticketId, phase, eventType: 'phase_failed', payload: { error: String(err) } });
      logger.error({ ticketId, phase, err }, 'phase failed');

      // Zod validation failure = bad AI output, retrying same input won't help
      if (err instanceof ZodValidationError) {
        await this.routeToDLQ(ticketId, phase, receiptHandle);
        return;
      }

      const updated = await getPhase(ticketId, phase);
      const attempts = updated?.attempts ?? WORKER_CONFIG.maxAttempts;

      if (attempts >= WORKER_CONFIG.maxAttempts) {
        await this.routeToDLQ(ticketId, phase, receiptHandle);
      } else {
        const delaySecs = calculateBackoffSeconds(attempts);
        logger.info({ ticketId, phase, attempts, delaySecs }, 'retry scheduled');
        await insertEvent({
          ticketId,
          phase,
          eventType: 'retry_scheduled',
          payload: { attempt: attempts, delaySecs },
        });
        await this.requeueTicket(ticketId, delaySecs);
        await this.deleteMessage(receiptHandle);
      }
    }
  }

  async processMessage(body: string, receiptHandle: string): Promise<void> {
    let rawMessage: unknown;
    try {
      rawMessage = JSON.parse(body);
    } catch {
      logger.warn({ body }, 'malformed JSON body, discarding');
      await this.deleteMessage(receiptHandle);
      return;
    }

    const parsed = MessageSchema.safeParse(rawMessage);

    if (!parsed.success) {
      logger.warn({ body }, 'malformed message, discarding');
      await this.deleteMessage(receiptHandle);
      return;
    }

    const { ticketId } = parsed.data;

    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      logger.warn({ ticketId }, 'ticket not found, discarding message');
      await this.deleteMessage(receiptHandle);
      return;
    }

    await updateTicketStatus(ticketId, 'processing');

    const phase1 = await getPhase(ticketId, 'phase1');
    const phase2 = await getPhase(ticketId, 'phase2');

    if (!phase1 || phase1.status !== 'success') {
      await this.runPhase(ticketId, 'phase1', receiptHandle, ticket, null);
      return;
    }

    if (!phase2 || phase2.status !== 'success') {
      const p1out = Phase1Schema.safeParse(phase1.output);
      if (!p1out.success) {
        logger.error({ ticketId }, 'phase1 output in DB failed schema validation, routing to DLQ');
        await this.routeToDLQ(ticketId, 'phase2', receiptHandle);
        return;
      }
      await this.runPhase(ticketId, 'phase2', receiptHandle, ticket, p1out.data);
      return;
    }

    // Both phases already complete — duplicate message, just clean up
    await updateTicketStatus(ticketId, 'completed');
    await this.deleteMessage(receiptHandle);
  }

  async poll(): Promise<void> {
    logger.info('worker started, polling SQS');

    while (!this.isShuttingDown) {
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

        await this.processMessage(msg.Body, msg.ReceiptHandle);
      } catch (err) {
        logger.error({ err }, 'poll error, retrying');
      }
    }

    logger.info('worker stopped');
    process.exit(0);
  }
}



const worker = new TicketWorker();

export async function processMessageForTest(body: string, receiptHandle: string): Promise<void> {
  return worker.processMessage(body, receiptHandle);
}

// Only start the poll loop outside test runners
if (process.env['NODE_ENV'] !== 'test' && !process.env['VITEST']) {
  worker.poll();
}
