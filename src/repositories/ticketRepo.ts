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
