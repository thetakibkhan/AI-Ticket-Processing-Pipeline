import type { QueryResult, QueryResultRow } from 'pg';

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
