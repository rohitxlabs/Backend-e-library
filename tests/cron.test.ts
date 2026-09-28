import request from 'supertest';
import { describe, expect, it } from 'vitest';
import defaultApp, { createApp } from '../src/app.js';
import { pool } from '../src/config/database.js';
import { createUsers } from '../src/services/user.service.js';
import { TEST_ADMIN_SECRET, TEST_CRON_SECRET, useTestDatabase } from './helpers.js';

const { mailer } = useTestDatabase();

const PATH = '/api/cron/password-setup-emails';

describe('serverless entry (Vercel)', () => {
  it('default-exports a ready Express app', async () => {
    expect(typeof defaultApp).toBe('function');
    const res = await request(defaultApp).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/password-setup-emails', () => {
  it.each([
    ['no credentials', {}],
    ['wrong secret', { Authorization: 'Bearer wrong-secret-value' }],
    ['the admin secret', { Authorization: `Bearer ${TEST_ADMIN_SECRET}` }],
  ])('rejects requests with %s', async (_label, headers) => {
    await createUsers(['a@example.com']);
    const res = await request(createApp()).get(PATH).set(headers);
    expect(res.status).toBe(401);
    expect(mailer().sent).toHaveLength(0);
  });

  it('runs one worker batch and reports the result', async () => {
    await pool.query(`INSERT INTO users (email) VALUES ('a@example.com'), ('b@example.com')`);
    const res = await request(createApp()).get(PATH).set('Authorization', `Bearer ${TEST_CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { claimed: 2, sent: 2, failed: 0 } });
    expect(mailer().sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);

    // A second call finds nothing left to send.
    const again = await request(createApp()).get(PATH).set('Authorization', `Bearer ${TEST_CRON_SECRET}`);
    expect(again.body.data).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });
});
