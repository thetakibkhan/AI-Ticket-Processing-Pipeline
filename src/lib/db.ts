import 'dotenv/config';
import pg from 'pg';
import logger from './logger.js';

const { Pool } = pg;

const DEFAULT_POOL_SIZE = 10;

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: parseInt(process.env['DB_POOL_MAX'] ?? String(DEFAULT_POOL_SIZE), 10),
});

pool.on('error', (err) => {
  logger.error({ err }, 'db pool error');
});

export default pool;
