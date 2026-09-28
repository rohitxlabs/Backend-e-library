import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/config/database.js';
import { generateSecureToken } from '../src/utils/crypto.js';
import { createActiveUser, createUserWithToken, STRONG_PASSWORD, useTestDatabase } from './helpers.js';

useTestDatabase();

const verify = (app = createApp(), token?: string) =>
  request(app).get('/api/auth/verify-setup-token').query(token === undefined ? {} : { token });

const setPassword = (app: ReturnType<typeof createApp>, body: Record<string, unknown>) =>
  request(app).post('/api/auth/set-password').send(body);

const INVALID_TOKEN = { success: false, message: 'Invalid or expired token' };

describe('GET /api/auth/verify-setup-token', () => {
  it('accepts a valid token without leaking details', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    const res = await verify(createApp(), rawToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { valid: true } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects unknown, malformed and missing tokens identically', async () => {
    for (const token of [generateSecureToken(), 'short', "' OR 1=1 --", undefined]) {
      const res = await verify(createApp(), token);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(INVALID_TOKEN);
    }
  });

  it('rejects an expired token', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    await pool.query(`UPDATE password_setup_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    const res = await verify(createApp(), rawToken);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  it('rejects a used token', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    await pool.query(`UPDATE password_setup_tokens SET used_at = NOW()`);
    expect((await verify(createApp(), rawToken)).status).toBe(400);
  });

  it('rejects a token whose user was deleted', async () => {
    const { rawToken, user } = await createUserWithToken('a@example.com');
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    expect((await verify(createApp(), rawToken)).status).toBe(400);
  });
});

describe('POST /api/auth/set-password', () => {
  it('rejects mismatched passwords', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    const res = await setPassword(createApp(), {
      token: rawToken,
      password: STRONG_PASSWORD,
      confirmPassword: 'Different123!',
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContainEqual({ field: 'confirmPassword', message: 'Passwords do not match' });
  });

  it.each([
    ['too short', 'Ab1!short'],
    ['no uppercase', 'newpassword123!'],
    ['no lowercase', 'NEWPASSWORD123!'],
    ['no digit', 'NewPassword!!!'],
    ['no symbol', 'NewPassword1234'],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const { rawToken } = await createUserWithToken('a@example.com');
    const res = await setPassword(createApp(), { token: rawToken, password, confirmPassword: password });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');
    // The token is untouched and can still be used.
    expect((await verify(createApp(), rawToken)).status).toBe(200);
  });

  it('sets the password with Argon2id and consumes the token', async () => {
    const { rawToken, user } = await createUserWithToken('a@example.com');
    const res = await setPassword(createApp(), {
      token: rawToken,
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { passwordSet: true } });

    const { rows } = await pool.query('SELECT password_hash, is_password_set FROM users WHERE id = $1', [user.id]);
    expect(rows[0].is_password_set).toBe(true);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(STRONG_PASSWORD);
    const token = await pool.query('SELECT used_at FROM password_setup_tokens');
    expect(token.rows[0].used_at).toBeInstanceOf(Date);
  });

  it('refuses to reuse a token', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    const body = { token: rawToken, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD };
    expect((await setPassword(createApp(), body)).status).toBe(200);
    const again = await setPassword(createApp(), { ...body, password: 'Another123!pass', confirmPassword: 'Another123!pass' });
    expect(again.status).toBe(400);
    expect(again.body).toEqual(INVALID_TOKEN);
  });

  it('rejects an expired token', async () => {
    const { rawToken } = await createUserWithToken('a@example.com');
    await pool.query(`UPDATE password_setup_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    const res = await setPassword(createApp(), { token: rawToken, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  it('lets exactly one of many concurrent requests use the same token', async () => {
    const { rawToken, user } = await createUserWithToken('a@example.com');
    const app = createApp();
    const passwords = Array.from({ length: 5 }, (_, i) => `Concurrent${i}Pass!`);

    const responses = await Promise.all(
      passwords.map((password) => setPassword(app, { token: rawToken, password, confirmPassword: password })),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(4);
    const { rows } = await pool.query('SELECT is_password_set FROM users WHERE id = $1', [user.id]);
    expect(rows[0].is_password_set).toBe(true);
  });

  it('an older token stops working once a newer one was issued', async () => {
    const first = await createUserWithToken('a@example.com');
    const { withTransaction } = await import('../src/config/database.js');
    const { issuePasswordSetupToken } = await import('../src/services/token.service.js');
    const second = await withTransaction((c) => issuePasswordSetupToken(c, first.user.id));
    expect((await verify(createApp(), first.rawToken)).status).toBe(400);
    expect((await verify(createApp(), second.rawToken)).status).toBe(200);
  });
});

describe('login / me / logout', () => {
  const login = (app: ReturnType<typeof createApp>, email: string, password: string) =>
    request(app).post('/api/auth/login').send({ email, password });

  it('logs in with a secure HTTP-only cookie and returns only safe fields', async () => {
    const user = await createActiveUser('a@example.com');
    const res = await login(createApp(), '  A@Example.com ', STRONG_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: user.id, email: 'a@example.com' } });
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    // The session id itself is never stored in the database.
    const sessionId = cookie.split(';')[0]!.split('=')[1]!;
    const stored = await pool.query('SELECT 1 FROM user_sessions WHERE session_hash = $1', [sessionId]);
    expect(stored.rowCount).toBe(0);
  });

  it('returns the same generic error for wrong password, unknown email, and unfinished setup', async () => {
    await createActiveUser('a@example.com');
    await createUserWithToken('pending@example.com');
    const app = createApp();

    const responses = await Promise.all([
      login(app, 'a@example.com', 'WrongPassword1!'),
      login(app, 'nobody@example.com', STRONG_PASSWORD),
      login(app, 'pending@example.com', STRONG_PASSWORD),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: 'Invalid email or password' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('GET /me returns the current user and requires a session', async () => {
    const user = await createActiveUser('a@example.com');
    const agent = request.agent(createApp());

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    await agent.post('/api/auth/login').send({ email: 'a@example.com', password: STRONG_PASSWORD }).expect(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ success: true, data: { id: user.id, email: 'a@example.com' } });
  });

  it('logout revokes the session server-side', async () => {
    await createActiveUser('a@example.com');
    const app = createApp();
    const res = await login(app, 'a@example.com', STRONG_PASSWORD);
    const cookie = res.headers['set-cookie']![0]!.split(';')[0]!;

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie']?.[0]).toMatch(/sid=;/);

    // Replaying the old cookie no longer works.
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect((await pool.query('SELECT 1 FROM user_sessions')).rowCount).toBe(0);
  });

  it('rejects an expired session', async () => {
    await createActiveUser('a@example.com');
    const agent = request.agent(createApp());
    await agent.post('/api/auth/login').send({ email: 'a@example.com', password: STRONG_PASSWORD }).expect(200);
    await pool.query(`UPDATE user_sessions SET expires_at = NOW() - INTERVAL '1 second'`);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('full flow: setup email token → set password → login', async () => {
    const { rawToken } = await createUserWithToken('flow@example.com');
    const agent = request.agent(createApp());
    await agent.get('/api/auth/verify-setup-token').query({ token: rawToken }).expect(200);
    await agent
      .post('/api/auth/set-password')
      .send({ token: rawToken, password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD })
      .expect(200);
    await agent.post('/api/auth/login').send({ email: 'flow@example.com', password: STRONG_PASSWORD }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.email).toBe('flow@example.com');
  });
});
