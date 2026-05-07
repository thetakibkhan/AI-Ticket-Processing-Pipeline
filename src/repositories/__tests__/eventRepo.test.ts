import { describe, it, expect, beforeEach } from 'vitest';
import { insertEvent, getEvents } from '../eventRepo.js';
import { insertTicket } from '../ticketRepo.js';
import pool from '../../lib/db.js';

beforeEach(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
});

describe('US-1.3 — Support Team Has a Full Audit Trail for Every Ticket', () => {
  it('records every state change with ticket reference', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const event = await insertEvent({
      ticketId: ticket.id,
      phase: 'phase1',
      eventType: 'phase_started',
    });
    expect(event.ticket_id).toBe(ticket.id);
    expect(event.event_type).toBe('phase_started');
  });

  it('each record includes timestamp', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const event = await insertEvent({
      ticketId: ticket.id,
      phase: 'phase1',
      eventType: 'phase_started',
    });
    expect(event.created_at).toBeDefined();
    expect(event.created_at).toBeInstanceOf(Date);
  });

  it('records are append-only — no update or delete exposed', async () => {
    const { insertEvent: _ie, getEvents: _ge, ...rest } = await import('../eventRepo.js');
    const exportedKeys = Object.keys(rest);
    expect(
      exportedKeys.filter(
        (k) => k.toLowerCase().includes('update') || k.toLowerCase().includes('delete'),
      ),
    ).toHaveLength(0);
  });

  it('returns full history in chronological order', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertEvent({ ticketId: ticket.id, phase: 'phase1', eventType: 'phase_started' });
    await insertEvent({ ticketId: ticket.id, phase: 'phase1', eventType: 'phase_completed' });
    await insertEvent({ ticketId: ticket.id, phase: 'phase2', eventType: 'phase_started' });

    const events = await getEvents(ticket.id);
    expect(events).toHaveLength(3);
    expect(events[0]!.event_type).toBe('phase_started');
    expect(events[1]!.event_type).toBe('phase_completed');
    expect(events[2]!.event_type).toBe('phase_started');
    expect(events[0]!.created_at <= events[1]!.created_at).toBe(true);
  });

  it('returns at most 20 events', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    for (let i = 0; i < 25; i++) {
      await insertEvent({ ticketId: ticket.id, phase: 'phase1', eventType: 'phase_started' });
    }
    const events = await getEvents(ticket.id);
    expect(events.length).toBeLessThanOrEqual(20);
  });

  it('stores optional payload with event', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const payload = { attempt: 2, waitMs: 2000 };
    const event = await insertEvent({
      ticketId: ticket.id,
      phase: 'phase1',
      eventType: 'retry_scheduled',
      payload,
    });
    expect(event.payload).toMatchObject(payload);
  });

  it('events isolated per ticket — one ticket history does not bleed into another', async () => {
    const t1 = await insertTicket({ subject: 'T1', body: 'B1' });
    const t2 = await insertTicket({ subject: 'T2', body: 'B2' });
    await insertEvent({ ticketId: t1.id, phase: 'phase1', eventType: 'phase_started' });
    await insertEvent({ ticketId: t2.id, phase: 'phase1', eventType: 'phase_failed' });

    const t1Events = await getEvents(t1.id);
    expect(t1Events).toHaveLength(1);
    expect(t1Events[0]!.event_type).toBe('phase_started');
  });
});
