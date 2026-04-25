import pool from '../lib/db.js';

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertTicketInput {
  subject: string;
  body: string;
}

export async function getTicketById(id: string | string[]): Promise<Ticket | null> {
  const { rows } = await pool.query<Ticket>(
    `SELECT * FROM tickets WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateTicketStatus(id: string, status: string): Promise<void> {
  await pool.query(`UPDATE tickets SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status]);
}

export async function insertTicket(input: InsertTicketInput): Promise<Ticket> {
  const { rows } = await pool.query<Ticket>(
    `INSERT INTO tickets (subject, body)
     VALUES ($1, $2)
     RETURNING *`,
    [input.subject, input.body],
  );

  const row = rows[0];
  if (!row) throw new Error('Insert returned no row');
  return row;
}
