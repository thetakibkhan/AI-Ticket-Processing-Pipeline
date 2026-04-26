import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import sqs from '../../lib/sqs.js';
import pool from '../../lib/db.js';
import { insertTicket } from '../../repositories/ticketRepo.js';
import { sendMessage } from '../../queues/producer.js';

vi.mock('../../adapters/aiAdapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../adapters/aiAdapter.js')>();
  return {
    ...actual,
    triageTicket: vi.fn().mockResolvedValue({
      category: 'technical',
      priority: 'high',
      sentiment: 'neutral',
      escalation: false,
      routingTarget: 'engineering',
      summary: 'User cannot login due to 403 error on admin panel',
    }),
    draftResolution: vi.fn().mockResolvedValue({
      customerReply: 'Thank you for reaching out. We are looking into your issue and will respond shortly.',
      internalNote: 'Reviewed by AI triage. Engineering team to investigate 403 error.',
      nextActions: ['Check permissions', 'Review logs'],
    }),
  };
});

const QUEUE_URL = process.env['SQS_QUEUE_URL']!;
const DLQ_URL = process.env['SQS_DLQ_URL']!;

async function drainQueue(queueUrl: string): Promise<void> {
  while (true) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 0 }),
    );
    if (!Messages?.length) break;
    await Promise.all(
      Messages.map(m => sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }))),
    );
  }
}

async function runWorkerOnce(ticketId: string): Promise<void> {
  const { processMessageForTest } = await import('../ticketWorker.js');
  const result = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
  );
  const msg = result.Messages?.[0];
  if (!msg?.Body || !msg.ReceiptHandle) throw new Error('No message received');
  await processMessageForTest(msg.Body, msg.ReceiptHandle);
}

beforeEach(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
  await drainQueue(QUEUE_URL);
  await drainQueue(DLQ_URL);
});

describe('US-3.1 — Worker processes tickets automatically', () => {
  it('processes phase1 and re-enqueues for phase2', async () => {
    const ticket = await insertTicket({ subject: 'Login broken', body: 'Cannot access' });
    await sendMessage(ticket.id);

    const { processMessageForTest } = await import('../ticketWorker.js');

    // Process phase1
    const r1 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    const msg1 = r1.Messages?.[0];
    expect(msg1).toBeDefined();
    await processMessageForTest(msg1!.Body!, msg1!.ReceiptHandle!);

    // ticket status = processing, phase1 = success
    const { rows: ticketRows } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(ticketRows[0]!.status).toBe('processing');

    const { rows: phaseRows } = await pool.query(
      'SELECT * FROM ticket_phases WHERE ticket_id = $1 AND phase = $2',
      [ticket.id, 'phase1'],
    );
    expect(phaseRows[0]!.status).toBe('success');
    expect(phaseRows[0]!.output).toBeDefined();

    // New message re-enqueued for phase2
    const r2 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    expect(r2.Messages?.[0]).toBeDefined();
    const body2 = JSON.parse(r2.Messages![0]!.Body!);
    expect(body2.ticketId).toBe(ticket.id);
  });

  it('processes phase2 and marks ticket completed', async () => {
    const ticket = await insertTicket({ subject: 'Billing issue', body: 'Wrong charge' });
    await sendMessage(ticket.id);

    const { processMessageForTest } = await import('../ticketWorker.js');

    // Phase 1
    const r1 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r1.Messages![0]!.Body!, r1.Messages![0]!.ReceiptHandle!);

    // Phase 2
    const r2 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r2.Messages![0]!.Body!, r2.Messages![0]!.ReceiptHandle!);

    const { rows } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(rows[0]!.status).toBe('completed');

    const { rows: p2 } = await pool.query(
      'SELECT status FROM ticket_phases WHERE ticket_id = $1 AND phase = $2',
      [ticket.id, 'phase2'],
    );
    expect(p2[0]!.status).toBe('success');
  });

  it('writes phase_started and phase_completed events', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await sendMessage(ticket.id);

    const { processMessageForTest } = await import('../ticketWorker.js');
    const r1 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r1.Messages![0]!.Body!, r1.Messages![0]!.ReceiptHandle!);

    const { rows } = await pool.query(
      'SELECT event_type FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticket.id],
    );
    const types = rows.map((r: { event_type: string }) => r.event_type);
    expect(types).toContain('phase_started');
    expect(types).toContain('phase_completed');
  });

  it('sets ticket status to processing on pickup', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await sendMessage(ticket.id);

    const { rows: before } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(before[0]!.status).toBe('queued');

    const { processMessageForTest } = await import('../ticketWorker.js');
    const r1 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r1.Messages![0]!.Body!, r1.Messages![0]!.ReceiptHandle!);

    const { rows: after } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    expect(after[0]!.status).toBe('processing');
  });
});

describe('US-3.2 — Completed phases are never re-run', () => {
  it('skips phase1 if already succeeded', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await sendMessage(ticket.id);

    const { processMessageForTest } = await import('../ticketWorker.js');

    // Complete phase1
    const r1 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r1.Messages![0]!.Body!, r1.Messages![0]!.ReceiptHandle!);

    const { rows: p1Before } = await pool.query(
      'SELECT attempts FROM ticket_phases WHERE ticket_id = $1 AND phase = $2',
      [ticket.id, 'phase1'],
    );
    const attemptsBefore = p1Before[0]!.attempts;

    // Process phase2 message
    const r2 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await processMessageForTest(r2.Messages![0]!.Body!, r2.Messages![0]!.ReceiptHandle!);

    const { rows: p1After } = await pool.query(
      'SELECT attempts FROM ticket_phases WHERE ticket_id = $1 AND phase = $2',
      [ticket.id, 'phase1'],
    );
    // phase1 attempts must not increase
    expect(p1After[0]!.attempts).toBe(attemptsBefore);
  });
});

describe('US-3.3 — Retry with exponential backoff', () => {
  it('discards malformed message without crashing', async () => {
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    await sqs.send(
      new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify({ bad: 'data' }) }),
    );

    const { processMessageForTest } = await import('../ticketWorker.js');
    const r = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    // Should not throw
    await expect(
      processMessageForTest(r.Messages![0]!.Body!, r.Messages![0]!.ReceiptHandle!),
    ).resolves.toBeUndefined();

    // Message deleted — queue empty
    const r2 = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    expect(r2.Messages ?? []).toHaveLength(0);
  });

  it('discards message for unknown ticketId', async () => {
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ ticketId: '00000000-0000-0000-0000-000000000000' }),
      }),
    );

    const { processMessageForTest } = await import('../ticketWorker.js');
    const r = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    await expect(
      processMessageForTest(r.Messages![0]!.Body!, r.Messages![0]!.ReceiptHandle!),
    ).resolves.toBeUndefined();
  });
});
