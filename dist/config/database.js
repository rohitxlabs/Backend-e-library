import pg from 'pg';
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
export async function query(text, params = []) {
    return pool.query(text, params);
}
/**
 * Runs `fn` inside BEGIN/COMMIT on a dedicated client, rolling back on any error.
 * The client is always released back to the pool.
 */
export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch (rollbackError) {
            logger.error('Transaction rollback failed', { error: serializeError(rollbackError) });
        }
        throw error;
    }
    finally {
        client.release();
    }
}
export async function checkDatabaseConnection() {
    await pool.query('SELECT 1');
}
export async function closePool() {
    await pool.end();
}
/** PostgreSQL error code helpers (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
export const PgErrorCode = {
    UNIQUE_VIOLATION: '23505',
    CHECK_VIOLATION: '23514',
};
export function isPgError(error, code) {
    return typeof error === 'object' && error !== null && error.code === code;
}
//# sourceMappingURL=database.js.map