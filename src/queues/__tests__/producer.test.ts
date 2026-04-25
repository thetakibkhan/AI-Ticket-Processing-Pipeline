import { describe, it, expect, beforeEach } from 'vitest';
import { sendMessage } from '../producer.js';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import sqs from '../../lib/sqs.js';

const QUEUE_URL = process.env['SQS_QUEUE_URL']!;

beforeEach(async () => {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL }));
  await new Promise(r => setTimeout(r, 300));
});

async function receiveOne() {
  const { Messages } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
  );
  return Messages?.[0] ?? null;
}

async function receiveMany(max: number) {
  const { Messages } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: max, WaitTimeSeconds: 2 }),
  );
  return Messages ?? [];
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

    const msgs = await receiveMany(10);
    expect(msgs.length).toBe(3);
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
