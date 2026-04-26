import { describe, it, expect, beforeEach } from 'vitest';
import { sendMessage } from '../producer.js';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import sqs from '../../lib/sqs.js';

const QUEUE_URL = process.env['SQS_QUEUE_URL']!;

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

beforeEach(async () => {
  await drainQueue(QUEUE_URL);
});

async function receiveOne() {
  const { Messages } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
  );
  return Messages?.[0] ?? null;
}

async function deleteMsg(receiptHandle: string) {
  await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: receiptHandle }));
}

describe('US-1.4 — Customer Tickets Are Queued and Processed in Order', () => {
  it('enqueues ticket to queue after save', async () => {
    await sendMessage('ticket-123');

    const msg = await receiveOne();
    expect(msg).not.toBeNull();
    const body = JSON.parse(msg!.Body!);
    expect(body.ticketId).toBe('ticket-123');
    await deleteMsg(msg!.ReceiptHandle!);
  });

  it('message body contains only ticketId', async () => {
    await sendMessage('ticket-abc');

    const msg = await receiveOne();
    expect(msg).not.toBeNull();
    const body = JSON.parse(msg!.Body!);
    expect(Object.keys(body)).toEqual(['ticketId']);
    await deleteMsg(msg!.ReceiptHandle!);
  });

  it('multiple tickets enqueued separately', async () => {
    await sendMessage('ticket-001');
    await sendMessage('ticket-002');
    await sendMessage('ticket-003');

    const received: string[] = [];
    for (let i = 0; i < 5 && received.length < 3; i++) {
      const { Messages } = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
      );
      if (Messages) {
        received.push(...Messages.map(m => String(JSON.parse(m.Body!).ticketId)));
        await Promise.all(
          Messages.map(m => sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }))),
        );
      }
    }
    expect(received).toHaveLength(3);
    expect(received).toContain('ticket-001');
    expect(received).toContain('ticket-002');
    expect(received).toContain('ticket-003');
  });

  it('queue holds message count correctly', async () => {
    await sendMessage('ticket-x');
    await sendMessage('ticket-y');

    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: QUEUE_URL, AttributeNames: ['ApproximateNumberOfMessages'] }),
    );
    expect(Number(Attributes?.['ApproximateNumberOfMessages'])).toBeGreaterThanOrEqual(2);
  });
});
