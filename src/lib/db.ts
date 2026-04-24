import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: parseInt(process.env['DB_POOL_MAX'] ?? '10', 10),
});

export default pool;
