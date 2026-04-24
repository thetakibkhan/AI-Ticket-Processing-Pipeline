import pool from '../lib/db.js';
import type { PhaseType } from './phaseRepo.js';

export type EventType =
  | 'phase_started'
  | 'phase_completed'
  | 'phase_failed'
  | 'retry_scheduled'
  | 'fallback_triggered'
  | 'dlq_routed';

export interface TicketEvent {
  id: string;
  ticket_id: string;
  phase: PhaseType;
  event_type: EventType;
  payload: unknown | null;
  created_at: Date;
}

export interface InsertEventInput {
  ticketId: string;
  phase: PhaseType;
  eventType: EventType;
  payload?: unknown;
}

export async function insertEvent(input: InsertEventInput): Promise<TicketEvent> {
  const { rows } = await pool.query<TicketEvent>(
    `INSERT INTO ticket_events (ticket_id, phase, event_type, payload)
     VALUES ($1, $2, $3, $4::json)
     RETURNING *`,
    [input.ticketId, input.phase, input.eventType, JSON.stringify(input.payload ?? null)],
  );

  const row = rows[0];
  if (!row) throw new Error('Insert returned no row');
  return row;
}

export async function getEvents(ticketId: string): Promise<TicketEvent[]> {
  const { rows } = await pool.query<TicketEvent>(
    `SELECT * FROM ticket_events
     WHERE ticket_id = $1
     ORDER BY created_at ASC
     LIMIT 20`,
    [ticketId],
  );

  return rows;
}
