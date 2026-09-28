import { env } from '../config/env.js';
import { query, type Queryable } from '../config/database.js';
import { generateSecureToken, hashToken } from '../utils/crypto.js';

export interface IssuedToken {
  /** Goes into the email only. Never stored, never logged. */
  rawToken: string;
  expiresAt: Date;
}

/**
 * Revokes the user's outstanding setup tokens and stores the hash of a fresh one.
 * Run it inside the caller's transaction so revoke + insert are atomic.
 */
export async function issuePasswordSetupToken(
  db: Queryable,
  userId: number,
  expiryMinutes = env.MAGIC_LINK_EXPIRY_MINUTES,
): Promise<IssuedToken> {
  await revokeUnusedTokens(db, userId);
  const rawToken = generateSecureToken();
  const result = await db.query<{ expires_at: Date }>(
    `INSERT INTO password_setup_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3))
     RETURNING expires_at`,
    [userId, hashToken(rawToken), expiryMinutes],
  );
  return { rawToken, expiresAt: result.rows[0]!.expires_at };
}

/** Marks every unused token of the user as consumed so old links stop working. */
export async function revokeUnusedTokens(db: Queryable, userId: number): Promise<void> {
  await db.query('UPDATE password_setup_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [
    userId,
  ]);
}

/** ${APP_URL}/set-password?token=<RAW_TOKEN> */
export function buildMagicLink(rawToken: string): string {
  const url = new URL('/set-password', `${env.APP_URL}/`);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

/**
 * Read-only check used by GET /verify-setup-token: the token exists, is unused, is not
 * expired, and belongs to an existing user who has not set a password yet.
 */
export async function isSetupTokenValid(rawToken: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
     FROM password_setup_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND t.used_at IS NULL
       AND t.expires_at > NOW()
       AND u.is_password_set = FALSE`,
    [hashToken(rawToken)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Housekeeping: drop tokens that expired or were used more than `olderThanDays` ago. */
export async function deleteStaleTokens(olderThanDays = 30): Promise<number> {
  const result = await query(
    `DELETE FROM password_setup_tokens
     WHERE COALESCE(used_at, expires_at) < NOW() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return result.rowCount ?? 0;
}
