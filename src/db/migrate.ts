import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { logger } from '../utils/logger.js';

// Resolves to src/db/migrations under tsx and dist/db/migrations after `npm run build`.
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

// Arbitrary constant key; serializes concurrent migration runs (e.g. two instances booting).
const MIGRATION_LOCK_KEY = 7_345_901;

/**
 * Applies every *.sql file in `dir` that is not yet recorded in schema_migrations, in filename
 * order. Each file runs in its own transaction under a transaction-scoped advisory lock, which
 * also works through Neon's PgBouncer pooler. Returns the names of newly applied migrations.
 */
export async function runMigrations(pool: Pool, dir = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.checksum !== checksum) {
          logger.warn('Applied migration file has changed since it ran; add a new migration instead', {
            migration: file,
          });
        }
        await client.query('COMMIT');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      applied.push(file);
      logger.info('Migration applied', { migration: file });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return applied;
}
