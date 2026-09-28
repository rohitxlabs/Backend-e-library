import { describe, expect, it } from 'vitest';
import { checkDatabaseConnection, pool } from '../src/config/database.js';
import { createUser, createUsers } from '../src/services/user.service.js';
import { useTestDatabase } from './helpers.js';

useTestDatabase();

describe('database', () => {
  it('connects', async () => {
    await expect(checkDatabaseConnection()).resolves.toBeUndefined();
  });

  it('has all migrations applied', async () => {
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual([
      '001_create_users.sql',
      '002_create_password_setup_tokens.sql',
      '003_add_setup_email_delivery_tracking.sql',
      '004_create_user_sessions.sql',
    ]);
  });
});

describe('user creation', () => {
  it('creates a user through the service with a normalized email', async () => {
    const user = await createUser('  Alice@Example.COM ');
    expect(user).toEqual({ id: expect.any(Number), email: 'alice@example.com' });
  });

  it('normalizes emails inserted manually with raw SQL (trigger)', async () => {
    const { rows } = await pool.query<{ email: string; is_password_set: boolean; setup_email_sent_at: Date | null }>(
      `INSERT INTO users (email) VALUES ('  Bob@Example.COM  ') RETURNING email, is_password_set, setup_email_sent_at`,
    );
    expect(rows[0]).toEqual({ email: 'bob@example.com', is_password_set: false, setup_email_sent_at: null });
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    await createUser('carol@example.com');
    await expect(createUser('CAROL@example.com')).rejects.toMatchObject({ statusCode: 409 });
    await expect(pool.query(`INSERT INTO users (email) VALUES ('Carol@Example.com')`)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('bulk insert skips existing emails', async () => {
    await createUser('dave@example.com');
    const created = await createUsers(['dave@example.com', 'erin@example.com', 'ERIN@example.com']);
    expect(created.map((u) => u.email)).toEqual(['erin@example.com']);
  });

  it('rejects malformed emails at the database level', async () => {
    await expect(pool.query(`INSERT INTO users (email) VALUES ('not-an-email')`)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('keeps is_password_set consistent with password_hash', async () => {
    const user = await createUser('frank@example.com');
    await expect(pool.query('UPDATE users SET is_password_set = TRUE WHERE id = $1', [user.id])).rejects.toMatchObject({
      code: '23514',
    });
  });
});
