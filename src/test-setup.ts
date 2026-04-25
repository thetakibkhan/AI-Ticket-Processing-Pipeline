import 'dotenv/config';
import { afterAll } from 'vitest';
import pool from './lib/db.js';

afterAll(async () => {
  await pool.end();
});
