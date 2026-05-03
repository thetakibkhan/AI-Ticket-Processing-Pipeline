import pool from '../lib/db.js';
import { assertSingleRow, type Queryable } from './repoUtils.js';

export type { Queryable };

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

export class TicketRepository {
  constructor(private readonly db: Queryable) {}

  async list(): Promise<Ticket[]> {
    const { rows } = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY created_at DESC`,
    );
    return rows;
  }

  async getById(id: string): Promise<Ticket | null> {
    const { rows } = await this.db.query<Ticket>(
      `SELECT * FROM tickets WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async insert(input: InsertTicketInput): Promise<Ticket> {
    const { rows } = await this.db.query<Ticket>(
      `INSERT INTO tickets (subject, body)
       VALUES ($1, $2)
       RETURNING *`,
      [input.subject, input.body],
    );
    return assertSingleRow(rows, 'insertTicket');
  }

  async updateStatus(id: string, status: TicketStatus): Promise<void> {
    await this.db.query(
      `UPDATE tickets SET status = $2, updated_at = NOW() WHERE id = $1`,
      [id, status],
    );
  }
}

export const ticketRepository = new TicketRepository(pool);

// Backward-compatible named exports — existing callers unchanged
export const getTickets = () => ticketRepository.list();
export const getTicketById = (id: string) => ticketRepository.getById(id);
export const insertTicket = (input: InsertTicketInput) => ticketRepository.insert(input);
export const updateTicketStatus = (id: string, status: TicketStatus) => ticketRepository.updateStatus(id, status);

export type LockResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'conflict' };

export async function lockTicketForReplay(db: Queryable, ticketId: string): Promise<LockResult> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM tickets WHERE id = $1 FOR UPDATE`,
    [ticketId],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'failed') return { ok: false, reason: 'conflict' };
  return { ok: true };
}

export async function setTicketQueued(db: Queryable, ticketId: string): Promise<void> {
  await db.query(
    `UPDATE tickets SET status = 'queued', updated_at = NOW() WHERE id = $1`,
    [ticketId],
  );
}
