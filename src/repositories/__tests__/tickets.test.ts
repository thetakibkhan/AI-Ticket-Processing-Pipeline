import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import pool from '../../lib/db.js';
import { PurgeQueueCommand } from '@aws-sdk/client-sqs';
import sqs from '../../lib/sqs.js';

const QUEUE_URL = process.env['SQS_QUEUE_URL']!;

beforeEach(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
  await sqs.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL }));
  await new Promise(r => setTimeout(r, 300));
});

// ─── US-2.1: POST /tickets ────────────────────────────────────────────────────

describe('US-2.1 — Customer Gets an Immediate Confirmation on Submission', () => {
  it('returns 202 with ticketId on valid submission', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ subject: 'Cannot login', body: 'Getting 403 on admin panel' });

    expect(res.status).toBe(202);
    expect(res.body.ticketId).toBeDefined();
    expect(res.body.status).toBe('queued');
    expect(res.body.message).toBeDefined();
  });

  it('returns unique ticketId for each submission', async () => {
    const r1 = await request(app).post('/tickets').send({ subject: 'Issue A', body: 'Body A' });
    const r2 = await request(app).post('/tickets').send({ subject: 'Issue B', body: 'Body B' });
    expect(r1.body.ticketId).not.toBe(r2.body.ticketId);
  });

  it('persists ticket to DB before responding', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ subject: 'DB check', body: 'Verify persistence' });

    const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [res.body.ticketId]);
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.status).toBe('queued');
  });

  it('returns 400 with field errors when subject missing', async () => {
    const res = await request(app).post('/tickets').send({ body: 'Missing subject' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('subject is required');
  });

  it('returns 400 with field errors when body missing', async () => {
    const res = await request(app).post('/tickets').send({ subject: 'Missing body' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('body is required');
  });

  it('returns 400 when both fields missing', async () => {
    const res = await request(app).post('/tickets').send({});
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
  });

  it('returns 400 when fields are whitespace only', async () => {
    const res = await request(app).post('/tickets').send({ subject: '   ', body: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
  });

  it('two identical submissions get different ticketIds', async () => {
    const r1 = await request(app).post('/tickets').send({ subject: 'Same', body: 'Same body' });
    const r2 = await request(app).post('/tickets').send({ subject: 'Same', body: 'Same body' });
    expect(r1.body.ticketId).not.toBe(r2.body.ticketId);
  });
});

// ─── US-2.2: GET /tickets/:id ─────────────────────────────────────────────────

describe('US-2.2 — Support Team Can Check the Status of Any Ticket at Any Time', () => {
  it('returns full ticket on valid id', async () => {
    const post = await request(app)
      .post('/tickets')
      .send({ subject: 'Login issue', body: 'Cannot access account' });

    const res = await request(app).get(`/tickets/${post.body.ticketId}`);

    expect(res.status).toBe(200);
    expect(res.body.ticketId).toBe(post.body.ticketId);
    expect(res.body.status).toBe('queued');
    expect(res.body.subject).toBe('Login issue');
    expect(res.body.body).toBe('Cannot access account');
  });

  it('returns both phase keys — null when not started', async () => {
    const post = await request(app)
      .post('/tickets')
      .send({ subject: 'Test', body: 'Body' });

    const res = await request(app).get(`/tickets/${post.body.ticketId}`);

    expect(res.body.phases).toBeDefined();
    expect(res.body.phases.phase1).toBeNull();
    expect(res.body.phases.phase2).toBeNull();
  });

  it('returns events array', async () => {
    const post = await request(app)
      .post('/tickets')
      .send({ subject: 'Test', body: 'Body' });

    const res = await request(app).get(`/tickets/${post.body.ticketId}`);

    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('returns 404 for unknown ticket id', async () => {
    const res = await request(app).get('/tickets/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.errors).toContain('Ticket not found');
  });

  it('shows phase output when phase completed', async () => {
    const post = await request(app)
      .post('/tickets')
      .send({ subject: 'Test', body: 'Body' });

    const ticketId = post.body.ticketId;
    await pool.query(
      `INSERT INTO ticket_phases (ticket_id, phase, status, output)
       VALUES ($1, 'phase1', 'success', $2::json)`,
      [ticketId, JSON.stringify({ category: 'Technical', priority: 'High' })],
    );

    const res = await request(app).get(`/tickets/${ticketId}`);
    expect(res.body.phases.phase1.status).toBe('success');
    expect(res.body.phases.phase1.output.category).toBe('Technical');
    expect(res.body.phases.phase2).toBeNull();
  });

  it('response format is consistent regardless of ticket stage', async () => {
    const post = await request(app)
      .post('/tickets')
      .send({ subject: 'Consistency', body: 'Test' });

    const res = await request(app).get(`/tickets/${post.body.ticketId}`);

    expect(res.body).toHaveProperty('ticketId');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('subject');
    expect(res.body).toHaveProperty('body');
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body).toHaveProperty('phases');
    expect(res.body).toHaveProperty('events');
  });
});

// ─── GET /tickets ─────────────────────────────────────────────────────────────

describe('GET /tickets', () => {
  it('returns empty list when there are no tickets', async () => {
    const res = await request(app).get('/tickets');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tickets: [] });
  });

  it('returns all tickets in descending created order', async () => {
    const first = await request(app)
      .post('/tickets/record')
      .send({ subject: 'First', body: 'First body' });
    const second = await request(app)
      .post('/tickets/record')
      .send({ subject: 'Second', body: 'Second body' });

    const res = await request(app).get('/tickets');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets[0].ticketId).toBe(second.body.ticketId);
    expect(res.body.tickets[1].ticketId).toBe(first.body.ticketId);
    expect(res.body.tickets[0]).toMatchObject({
      status: 'queued',
      subject: 'Second',
      body: 'Second body',
    });
    expect(res.body.tickets[0].createdAt).toBeDefined();
  });
});
