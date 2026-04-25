import { describe, it, expect, beforeEach } from 'vitest';
import { insertPhase, getPhase, updatePhaseStatus } from '../phaseRepo.js';
import { insertTicket } from '../ticketRepo.js';
import pool from '../../lib/db.js';

beforeEach(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
});

describe('US-1.2 — Support Team Can Always See Where a Ticket Stands', () => {
  it('records which phase a ticket is currently in', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const phase = await insertPhase(ticket.id, 'phase1');
    expect(phase.phase).toBe('phase1');
    expect(phase.ticket_id).toBe(ticket.id);
  });

  it('phase status defaults to started on insert', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const phase = await insertPhase(ticket.id, 'phase1');
    expect(phase.status).toBe('started');
  });

  it('phase status updates automatically as ticket progresses', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertPhase(ticket.id, 'phase1');
    const updated = await updatePhaseStatus(ticket.id, 'phase1', 'success');
    expect(updated.status).toBe('success');
  });

  it('preserves last known state if ticket interrupted mid-process', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertPhase(ticket.id, 'phase1');
    await updatePhaseStatus(ticket.id, 'phase1', 'progress');

    const phase = await getPhase(ticket.id, 'phase1');
    expect(phase?.status).toBe('progress');
  });

  it('shows partial state — phase1 complete, phase2 still pending', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertPhase(ticket.id, 'phase1');
    await insertPhase(ticket.id, 'phase2');
    await updatePhaseStatus(ticket.id, 'phase1', 'success');

    const p1 = await getPhase(ticket.id, 'phase1');
    const p2 = await getPhase(ticket.id, 'phase2');
    expect(p1?.status).toBe('success');
    expect(p2?.status).toBe('started');
  });

  it('getPhase returns null for non-existent phase', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    const phase = await getPhase(ticket.id, 'phase1');
    expect(phase).toBeNull();
  });

  it('prevents duplicate phases for same ticket', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertPhase(ticket.id, 'phase1');
    await expect(insertPhase(ticket.id, 'phase1')).rejects.toThrow();
  });

  it('stores output on phase completion', async () => {
    const ticket = await insertTicket({ subject: 'Test', body: 'Body' });
    await insertPhase(ticket.id, 'phase1');
    const output = { category: 'Billing', priority: 'High' };
    const updated = await updatePhaseStatus(ticket.id, 'phase1', 'success', output);
    expect(updated.output).toMatchObject(output);
  });
});
