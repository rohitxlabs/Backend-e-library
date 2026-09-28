import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createActiveUser, STRONG_PASSWORD, TEST_FRONTEND_URL, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('rate limiting', () => {
  it('blocks brute-force login attempts from one IP', async () => {
    const app = createApp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: `x${i}@example.com`, password: 'Wrong123!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('returns the standard error envelope and RateLimit headers', async () => {
    const app = createApp();
    let res = await request(app).get('/api/auth/verify-setup-token').query({ token: 'x' });
    expect(res.headers['ratelimit-policy']).toBeDefined();
    for (let i = 0; i < 30; i++) res = await request(app).get('/api/auth/verify-setup-token').query({ token: 'x' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ success: false, message: 'Too many requests. Please try again later.' });
  });

  it('limits set-password attempts', async () => {
    const app = createApp();
    let res;
    for (let i = 0; i < 11; i++) res = await request(app).post('/api/auth/set-password').send({ token: 'x' });
    expect(res!.status).toBe(429);
  });
});

describe('CORS and origin checks', () => {
  it('allows the configured frontend with credentials', async () => {
    const res = await request(createApp())
      .options('/api/auth/login')
      .set('Origin', TEST_FRONTEND_URL)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(TEST_FRONTEND_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow other origins', async () => {
    const res = await request(createApp()).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses state-changing requests from foreign origins (CSRF)', async () => {
    await createActiveUser('a@example.com');
    const res = await request(createApp())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.com', password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('general hardening', () => {
  it('sets Helmet security headers and hides Express', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /health reports database connectivity', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'up' } });
  });

  it('answers malformed JSON with 400 and unknown routes with 404', async () => {
    const app = createApp();
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ success: false, message: 'Malformed JSON body' });
    const missing = await request(app).get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, message: 'Route not found' });
  });

  it('rejects oversized bodies', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
  });
});
