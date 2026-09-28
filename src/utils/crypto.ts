import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/** 32 bytes = 256 bits of CSPRNG entropy, base64url-encoded (43 URL-safe characters). */
export const TOKEN_BYTES = 32;

export function generateSecureToken(bytes = TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 hex digest of a high-entropy random token. A fast hash is appropriate here (unlike
 * passwords): a 256-bit random value cannot be brute-forced, and the lookup must be exact.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/** Argon2id with the library's defaults (m=64 MiB, t=3, p=4) — above the OWASP minimum. */
const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // Malformed hash — treat as a failed verification rather than a 500.
    return false;
  }
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * Burns the same Argon2 verification time as a real login when the account does not exist or
 * has no password, so response timing does not reveal which emails are registered.
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword(generateSecureToken());
  await verifyPassword(await dummyHashPromise, password);
}
