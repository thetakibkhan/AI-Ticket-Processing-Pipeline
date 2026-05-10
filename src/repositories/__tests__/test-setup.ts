import 'dotenv/config';
import { afterAll, beforeAll } from 'vitest';
import pool from '../../lib/db.js';

process.env['NODE_ENV'] = 'test';

beforeAll(async () => {
  await pool.query(`
    ALTER TABLE ticket_events
    DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;
  `);

  await pool.query(`
    ALTER TABLE ticket_events
    ADD CONSTRAINT ticket_events_event_type_check
    CHECK (event_type IN (
      'phase_started',
      'phase_completed',
      'phase_failed',
      'retry_scheduled',
      'fallback_triggered',
      'dlq_routed',
      'dlq_send_failed',
      'manual_retry_triggered',
      'enqueue_failed'
    ));
  `);
});

afterAll(async () => {
  await pool.query('DELETE FROM ticket_events');
  await pool.query('DELETE FROM ticket_phases');
  await pool.query('DELETE FROM tickets');
  await pool.end();
});
