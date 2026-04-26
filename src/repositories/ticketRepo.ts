import pool from '../lib/db.js';
import { assertSingleRow } from './repoUtils.js';

export type TicketStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: TicketStatus;
  created_at: Date;
  updated_at: Date;
}

export interface InsertTicketInput {
  subject: string;
  body: string;
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const { rows } = await pool.query<Ticket>(
    `SELECT * FROM tickets WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateTicketStatus(id: string, status: TicketStatus): Promise<void> {
  await pool.query(`UPDATE tickets SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status]);
}

export async function insertTicket(input: InsertTicketInput): Promise<Ticket> {
  const { rows } = await pool.query<Ticket>(
    `INSERT INTO tickets (subject, body)
     VALUES ($1, $2)
     RETURNING *`,
    [input.subject, input.body],
  );
  return assertSingleRow(rows, 'insertTicket');
}
