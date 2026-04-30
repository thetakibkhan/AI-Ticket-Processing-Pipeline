import pool from '../lib/db.js';
import { assertSingleRow } from './repoUtils.js';
import type { PhaseType } from './phaseRepo.js';

const MAX_EVENTS_PER_TICKET = 20;

export type EventType =
  | 'phase_started'
  | 'phase_completed'
  | 'phase_failed'
  | 'retry_scheduled'
  | 'fallback_triggered'
  | 'dlq_routed'
  | 'dlq_send_failed'
  | 'manual_retry_triggered';

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
  return assertSingleRow(rows, 'insertEvent');
}

export async function getEvents(ticketId: string): Promise<TicketEvent[]> {
  const { rows } = await pool.query<TicketEvent>(
    `SELECT * FROM ticket_events
     WHERE ticket_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [ticketId, MAX_EVENTS_PER_TICKET],
  );
  return rows;
}
