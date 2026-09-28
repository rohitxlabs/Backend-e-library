import { describe, expect, it } from 'vitest';
import { pool } from '../src/config/database.js';
import { processPendingSetupEmails } from '../src/services/password-setup-email.service.js';
import { createUsers } from '../src/services/user.service.js';
import { hashToken } from '../src/utils/crypto.js';
import { createActiveUser, useTestDatabase } from './helpers.js';

const { mailer } = useTestDatabase();

const emails = (n: number, prefix = 'user') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}@example.com`);

async function userRow(email: string) {
  const { rows } = await pool.query<{
    id: number;
    setup_email_sent_at: Date | null;
    setup_email_attempts: number;
    setup_email_next_attempt_at: Date | null;
    setup_email_last_error: string | null;
    setup_email_claim_id: string | null;
  }>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0]!;
}

describe('password setup email worker', () => {
  it('detects manually inserted users and emails them a magic link', async () => {
    await pool.query(`INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com'), ('c@example.com')`);

    const result = await processPendingSetupEmails();

    expect(result).toEqual({ claimed: 3, sent: 3, failed: 0 });
    expect(mailer().sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    const row = await userRow('a@example.com');
    expect(row.setup_email_sent_at).toBeInstanceOf(Date);
    expect(row.setup_email_claim_id).toBeNull();
  });

  it('stores only the token hash, with a ~24h expiry', async () => {
    await createUsers(['a@example.com']);
    await processPendingSetupEmails();
    const rawToken = mailer().tokenFor('a@example.com');

    const { rows } = await pool.query<{ token_hash: string; hours: number }>(
      `SELECT token_hash, EXTRACT(EPOCH FROM expires_at - created_at) / 3600 AS hours FROM password_setup_tokens`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(hashToken(rawToken));
    expect(rows[0]!.token_hash).not.toBe(rawToken);
    expect(Math.round(Number(rows[0]!.hours))).toBe(24);
    const plaintext = await pool.query(`SELECT 1 FROM password_setup_tokens WHERE token_hash = $1`, [rawToken]);
    expect(plaintext.rowCount).toBe(0);
  });

  it('processes users in batches and never emails anyone twice', async () => {
    await createUsers(emails(30));

    expect(await processPendingSetupEmails({ batchSize: 25 })).toEqual({ claimed: 25, sent: 25, failed: 0 });
    expect(await processPendingSetupEmails({ batchSize: 25 })).toEqual({ claimed: 5, sent: 5, failed: 0 });
    expect(await processPendingSetupEmails({ batchSize: 25 })).toEqual({ claimed: 0, sent: 0, failed: 0 });

    expect(mailer().sent).toHaveLength(30);
    expect(new Set(mailer().sent.map((m) => m.to)).size).toBe(30);
  });

  it('skips users who already set a password', async () => {
    await createActiveUser('done@example.com');
    await createUsers(['new@example.com']);
    await processPendingSetupEmails();
    expect(mailer().sent.map((m) => m.to)).toEqual(['new@example.com']);
  });

  it('continues after a failure and does not mark the failed user as sent', async () => {
    await createUsers(['ok1@example.com', 'bad@example.com', 'ok2@example.com']);
    mailer().failFor.add('bad@example.com');

    const result = await processPendingSetupEmails();

    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1 });
    const bad = await userRow('bad@example.com');
    expect(bad.setup_email_sent_at).toBeNull();
    expect(bad.setup_email_attempts).toBe(1);
    expect(bad.setup_email_last_error).toContain('550');
    expect(bad.setup_email_next_attempt_at!.getTime()).toBeGreaterThan(Date.now());
    expect(bad.setup_email_claim_id).toBeNull();
    // The token for the undelivered email was revoked.
    const tokens = await pool.query('SELECT 1 FROM password_setup_tokens WHERE user_id = $1 AND used_at IS NULL', [
      bad.id,
    ]);
    expect(tokens.rowCount).toBe(0);
  });

  it('retries a failed user after the backoff and succeeds', async () => {
    await createUsers(['flaky@example.com']);
    mailer().failFor.add('flaky@example.com');
    await processPendingSetupEmails();

    // Still inside the backoff window: not retried.
    mailer().failFor.clear();
    expect((await processPendingSetupEmails()).claimed).toBe(0);

    // Backoff elapsed.
    await pool.query(`UPDATE users SET setup_email_next_attempt_at = NOW() - INTERVAL '1 second'`);
    expect(await processPendingSetupEmails()).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const row = await userRow('flaky@example.com');
    expect(row.setup_email_sent_at).toBeInstanceOf(Date);
    expect(row.setup_email_last_error).toBeNull();
  });

  it('stops retrying after EMAIL_MAX_ATTEMPTS (3 in tests)', async () => {
    await createUsers(['dead@example.com']);
    mailer().failFor.add('dead@example.com');
    for (let i = 0; i < 5; i++) {
      await processPendingSetupEmails();
      await pool.query(`UPDATE users SET setup_email_next_attempt_at = NULL`);
    }
    expect((await userRow('dead@example.com')).setup_email_attempts).toBe(3);
  });

  it('does not double-send when several workers run concurrently', async () => {
    await createUsers(emails(40));
    mailer().delayMs = 5; // widen the race window

    const results = await Promise.all(Array.from({ length: 4 }, () => processPendingSetupEmails({ batchSize: 15 })));

    const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
    expect(totalSent).toBe(40);
    expect(mailer().sent).toHaveLength(40);
    expect(new Set(mailer().sent.map((m) => m.to)).size).toBe(40);
  });

  it('re-processes users whose claim lease expired (crashed worker)', async () => {
    await createUsers(['orphan@example.com']);
    await pool.query(
      `UPDATE users SET setup_email_claim_id = gen_random_uuid(), setup_email_claimed_at = NOW() - INTERVAL '1 hour'`,
    );
    expect(await processPendingSetupEmails()).toEqual({ claimed: 1, sent: 1, failed: 0 });
  });

  it('does not touch users with a live claim held by another worker', async () => {
    await createUsers(['busy@example.com']);
    await pool.query(`UPDATE users SET setup_email_claim_id = gen_random_uuid(), setup_email_claimed_at = NOW()`);
    expect((await processPendingSetupEmails()).claimed).toBe(0);
  });

  it('honors the recipient allowlist', async () => {
    await createUsers(['allowed@example.com', 'other@example.com']);
    const result = await processPendingSetupEmails({ allowlist: ['allowed@example.com'] });
    expect(result.sent).toBe(1);
    expect(mailer().sent.map((m) => m.to)).toEqual(['allowed@example.com']);
  });
});
