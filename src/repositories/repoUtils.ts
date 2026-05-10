import type { QueryResult, QueryResultRow, PoolClient } from 'pg';
import pool from '../lib/db.js';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export function assertSingleRow<T>(rows: T[], context: string): T {
  const row = rows[0];
  if (!row) throw new Error(`${context} returned no row`);
  return row;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
