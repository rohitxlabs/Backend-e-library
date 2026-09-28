import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { env } from './env.js';
import { logger, serializeError } from '../utils/logger.js';

/**
 * One shared connection pool for the whole process. Works with both the Neon pooled
 * ("-pooler") and direct endpoints: every transaction runs on a single checked-out client,
 * and no session-level state (SET, session advisory locks, named prepared statements) is used.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Neon closes idle connections; keepalive avoids surprising resets on long-lived pools.
  keepAlive: true,
});

// An idle client can error when the server drops it (e.g. Neon compute suspends). Without a
// listener this would crash the process; the pool discards the client and reconnects on demand.
pool.on('error', (error) => {
  logger.error('Idle PostgreSQL client error', { error: serializeError(error) });
});

/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

/**
 * Runs `fn` inside BEGIN/COMMIT on a dedicated client, rolling back on any error.
 * The client is always released back to the pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Transaction rollback failed', { error: serializeError(rollbackError) });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** PostgreSQL error code helpers (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
} as const;

export function isPgError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
