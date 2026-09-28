import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/config/database.js';
import { processPendingSetupEmails } from '../src/services/password-setup-email.service.js';
import { createUsers } from '../src/services/user.service.js';
import { createActiveUser, TEST_ADMIN_SECRET, useTestDatabase } from './helpers.js';

const { mailer } = useTestDatabase();

const auth = { Authorization: `Bearer ${TEST_ADMIN_SECRET}` };

describe('admin authentication', () => {
  it.each([
    ['no credentials', {}],
    ['wrong bearer secret', { Authorization: 'Bearer wrong-secret' }],
    ['wrong header secret', { 'X-Admin-Secret': 'wrong-secret' }],
    ['secret prefix', { Authorization: `Bearer ${TEST_ADMIN_SECRET.slice(0, -1)}` }],
  ])('rejects requests with %s', async (_label, headers) => {
    for (const [method, path] of [
      ['get', '/api/admin/users'],
      ['get', '/api/admin/email-status'],
      ['post', '/api/admin/resend-password-setup/1'],
    ] as const) {
      const res = await request(createApp())[method](path).set(headers);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: 'Unauthorized' });
    }
  });

  it('accepts the X-Admin-Secret header', async () => {
    const res = await request(createApp()).get('/api/admin/email-status').set('X-Admin-Secret', TEST_ADMIN_SECRET);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/users', () => {
  it('lists users with safe fields only, paginated and filterable', async () => {
    await createActiveUser('done@example.com');
    await createUsers(['p1@example.com', 'p2@example.com']);
    const app = createApp();

    const res = await request(app).get('/api/admin/users').set(auth).query({ pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/password_hash|passwordHash|token|argon2/);
    expect(res.body.data.users[0]).toEqual({
      id: 1,
      email: 'done@example.com',
      isPasswordSet: true,
      setupEmailStatus: 'password_set',
      setupEmailSentAt: null,
      setupEmailAttempts: 0,
      setupEmailLastError: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const pending = await request(app).get('/api/admin/users').set(auth).query({ status: 'pending' });
    expect(pending.body.data.users.map((u: { email: string }) => u.email)).toEqual(['p1@example.com', 'p2@example.com']);

    const search = await request(app).get('/api/admin/users').set(auth).query({ search: 'P2' });
    expect(search.body.data.users).toHaveLength(1);
  });

  it('validates query parameters', async () => {
    const res = await request(createApp()).get('/api/admin/users').set(auth).query({ pageSize: 1000 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/email-status', () => {
  it('reports pending / sent / failed / passwordsSet counts', async () => {
    await createActiveUser('done@example.com');
    await createUsers(['s1@example.com', 's2@example.com', 'fail@example.com', 'later@example.com']);
    mailer().failFor.add('fail@example.com');
    await processPendingSetupEmails({ batchSize: 3 });

    const res = await request(createApp()).get('/api/admin/email-status').set(auth);
    expect(res.status).toBe(200);
    // fail@ is scheduled for retry, so still counted as pending (attempts 1 < max 3).
    expect(res.body).toEqual({
      success: true,
      data: { total: 5, pending: 2, sent: 2, failed: 0, awaitingPassword: 2, passwordsSet: 1 },
    });
  });
});

describe('POST /api/admin/resend-password-setup/:userId', () => {
  it('invalidates the old link and emails a new one without exposing the token', async () => {
    const [user] = await createUsers(['r@example.com']);
    await processPendingSetupEmails();
    const oldToken = mailer().tokenFor('r@example.com');
    const app = createApp();

    const res = await request(app).post(`/api/admin/resend-password-setup/${user!.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sent: true } });

    const newToken = mailer().tokenFor('r@example.com');
    expect(newToken).not.toBe(oldToken);
    expect(JSON.stringify(res.body)).not.toContain(newToken);
    expect((await request(app).get('/api/auth/verify-setup-token').query({ token: oldToken })).status).toBe(400);
    expect((await request(app).get('/api/auth/verify-setup-token').query({ token: newToken })).status).toBe(200);
  });

  it('works for users whose automatic emails failed permanently', async () => {
    const [user] = await createUsers(['f@example.com']);
    await pool.query('UPDATE users SET setup_email_attempts = 99 WHERE id = $1', [user!.id]);
    const res = await request(createApp()).post(`/api/admin/resend-password-setup/${user!.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(mailer().sent).toHaveLength(1);
  });

  it('returns 404 / 409 / 400 / 502 as appropriate', async () => {
    const app = createApp();
    const active = await createActiveUser('done@example.com');
    const [pending] = await createUsers(['bounce@example.com']);
    mailer().failFor.add('bounce@example.com');

    expect((await request(app).post('/api/admin/resend-password-setup/999').set(auth)).status).toBe(404);
    expect((await request(app).post(`/api/admin/resend-password-setup/${active.id}`).set(auth)).status).toBe(409);
    expect((await request(app).post('/api/admin/resend-password-setup/abc').set(auth)).status).toBe(400);
    const failed = await request(app).post(`/api/admin/resend-password-setup/${pending!.id}`).set(auth);
    expect(failed.status).toBe(502);
    expect(failed.body.message).not.toMatch(/550/); // SMTP details stay in the logs
  });
});
