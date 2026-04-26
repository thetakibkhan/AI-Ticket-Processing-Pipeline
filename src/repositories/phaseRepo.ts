import pool from '../lib/db.js';
import { assertSingleRow } from './repoUtils.js';

export type PhaseType = 'phase1' | 'phase2';
export type PhaseStatus = 'started' | 'progress' | 'success' | 'failure';

export interface TicketPhase {
  id: string;
  ticket_id: string;
  phase: PhaseType;
  status: PhaseStatus;
  attempts: number;
  output: unknown | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export async function insertPhase(ticketId: string, phase: PhaseType): Promise<TicketPhase> {
  const { rows } = await pool.query<TicketPhase>(
    `INSERT INTO ticket_phases (ticket_id, phase)
     VALUES ($1, $2)
     RETURNING *`,
    [ticketId, phase],
  );
  return assertSingleRow(rows, 'insertPhase');
}

export async function getPhase(ticketId: string, phase: PhaseType): Promise<TicketPhase | null> {
  const { rows } = await pool.query<TicketPhase>(
    `SELECT * FROM ticket_phases WHERE ticket_id = $1 AND phase = $2`,
    [ticketId, phase],
  );
  return rows[0] ?? null;
}

export async function updatePhaseStatus(
  ticketId: string,
  phase: PhaseType,
  status: PhaseStatus,
  output?: unknown,
): Promise<TicketPhase> {
  const isTerminal = status === 'success' || status === 'failure';
  const isStarting = status === 'started';

  const { rows } = await pool.query<TicketPhase>(
    `UPDATE ticket_phases
     SET
       status       = $3,
       attempts     = attempts + CASE WHEN $4 THEN 1 ELSE 0 END,
       output       = COALESCE($5::json, output),
       started_at   = CASE WHEN $4 THEN NOW() ELSE started_at END,
       completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END
     WHERE ticket_id = $1 AND phase = $2
     RETURNING *`,
    [ticketId, phase, status, isStarting, JSON.stringify(output ?? null), isTerminal],
  );

  return assertSingleRow(rows, 'updatePhaseStatus');
}
