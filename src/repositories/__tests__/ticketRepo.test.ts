import { describe, it, expect, beforeEach } from 'vitest';
import { insertTicket } from '../ticketRepo.js';
import pool from '../../lib/db.js';

beforeEach(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
});

describe('US-1.1 — Customer Requests Are Never Lost', () => {
  it('writes ticket to permanent storage immediately', async () => {
    const ticket = await insertTicket({ subject: 'Login broken', body: 'Cannot login since yesterday' });
    expect(ticket.id).toBeDefined();
    expect(ticket.subject).toBe('Login broken');
    expect(ticket.body).toBe('Cannot login since yesterday');
  });

  it('assigns a unique id to each ticket', async () => {
    const t1 = await insertTicket({ subject: 'Issue A', body: 'Body A' });
    const t2 = await insertTicket({ subject: 'Issue B', body: 'Body B' });
    expect(t1.id).not.toBe(t2.id);
  });

  it('stores body exactly as submitted — never modified', async () => {
    const body = '  Hello! I have a   problem with my invoice #1234.  ';
    const ticket = await insertTicket({ subject: 'Invoice issue', body });
    expect(ticket.body).toBe(body);
  });

  it('persists ticket in DB — survives beyond function call', async () => {
    const ticket = await insertTicket({ subject: 'Persisted', body: 'Check DB' });
    const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [ticket.id]);
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.id).toBe(ticket.id);
  });

  it('one ticket failure does not affect another', async () => {
    const t1 = await insertTicket({ subject: 'Ticket 1', body: 'Body 1' });
    const t2 = await insertTicket({ subject: 'Ticket 2', body: 'Body 2' });

    await pool.query('DELETE FROM tickets WHERE id = $1', [t1.id]);

    const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [t2.id]);
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.id).toBe(t2.id);
  });

  it('ticket gets default status of queued', async () => {
    const ticket = await insertTicket({ subject: 'Status check', body: 'Body' });
    expect(ticket.status).toBe('queued');
  });
});
