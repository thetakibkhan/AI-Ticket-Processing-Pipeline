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
      'manual_retry_triggered'
    ));
  `);
});

afterAll(async () => {
  await pool.end();
});
