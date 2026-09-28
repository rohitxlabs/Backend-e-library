import { describe, expect, it } from 'vitest';
import { buildMagicLink } from '../src/services/token.service.js';
import { generateSecureToken, hashPassword, hashToken, safeEqual, verifyPassword } from '../src/utils/crypto.js';

describe('token generation', () => {
  it('produces 256-bit URL-safe tokens', () => {
    const token = generateSecureToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSecureToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe('token hashing', () => {
  it('is a deterministic SHA-256 hex digest that does not contain the token', () => {
    const token = generateSecureToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hashToken(generateSecureToken())).not.toBe(hash);
  });
});

describe('magic link', () => {
  it('points at the frontend set-password page', () => {
    const token = generateSecureToken();
    expect(buildMagicLink(token)).toBe(`http://localhost:3000/set-password?token=${token}`);
  });
});

describe('password hashing', () => {
  it('uses Argon2id and verifies correctly', async () => {
    const hash = await hashPassword('NewPassword123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'NewPassword123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'WrongPassword123!')).resolves.toBe(false);
    await expect(verifyPassword('garbage', 'x')).resolves.toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
