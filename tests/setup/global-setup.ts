import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import { applyTestEnv } from './test-env.js';

/** Runs once before all test files: bring the test database schema up to date. */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
