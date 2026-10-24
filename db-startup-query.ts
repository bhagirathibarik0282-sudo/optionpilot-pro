import type { Pool, PoolClient } from 'pg';

/** Startup-only transaction budgets. SET LOCAL cannot leak into replay/live
 * queries, and PostgreSQL cancels blocked work rather than abandoning a client
 * timer while its SQL continues holding a connection. */
export async function withStartupDatabaseClient<T>(
 pool: Pick<Pool, 'connect'>,
 work: (client: PoolClient) => Promise<T>,
): Promise<T> {
 const client=await pool.connect();
 let discard=false;
 try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query("SET LOCAL lock_timeout = '3s'");
  const result=await work(client);
  await client.query('COMMIT');
  return result;
 } catch(error) {
  try { await client.query('ROLLBACK'); } catch { discard=true; }
  throw error;
 } finally { client.release(discard); }
}
