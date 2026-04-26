export function assertSingleRow<T>(rows: T[], context: string): T {
  const row = rows[0];
  if (!row) throw new Error(`${context} returned no row`);
  return row;
}
