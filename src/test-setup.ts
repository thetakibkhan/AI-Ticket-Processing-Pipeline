import 'dotenv/config';
import { afterAll } from 'vitest';
import pool from './lib/db.js';

process.env['NODE_ENV'] = 'test';

afterAll(async () => {
  await pool.end();
});
