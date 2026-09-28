import { withTransaction } from '../config/database.js';
import { hashPassword, hashToken, verifyAgainstDummyHash, verifyPassword } from '../utils/crypto.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { createSession, deleteSession, type CreatedSession } from './session.service.js';
import { isSetupTokenValid, revokeUnusedTokens } from './token.service.js';
import { findUserByEmail, type SafeUser } from './user.service.js';

/** Throws 400 "Invalid or expired token" unless the token can still be used to set a password. */
export async function verifySetupToken(rawToken: string): Promise<void> {
  if (!(await isSetupTokenValid(rawToken))) throw Errors.invalidToken();
}

/**
 * Atomically consumes a setup token and sets the user's password.
 *
 * The token and user rows are locked with SELECT ... FOR UPDATE, so concurrent requests with
 * the same token serialize: the first commits, the rest see used_at set and are rejected.
 */
export async function setPasswordWithToken(rawToken: string, password: string): Promise<SafeUser> {
  const tokenHash = hashToken(rawToken);

  const user = await withTransaction(async (client) => {
    const result = await client.query<{
      token_id: number;
      used_at: Date | null;
      is_unexpired: boolean;
      user_id: number;
      email: string;
      is_password_set: boolean;
    }>(
      `SELECT t.id AS token_id, t.used_at, t.expires_at > NOW() AS is_unexpired,
              u.id AS user_id, u.email, u.is_password_set
       FROM password_setup_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
       FOR UPDATE OF t, u`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.used_at !== null || !row.is_unexpired || row.is_password_set) {
      throw Errors.invalidToken();
    }

    const passwordHash = await hashPassword(password);
    await client.query(
      `UPDATE users
       SET password_hash = $2,
           is_password_set = TRUE,
           setup_email_claim_id = NULL,
           setup_email_claimed_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [row.user_id, passwordHash],
    );
    await client.query('UPDATE password_setup_tokens SET used_at = NOW() WHERE id = $1', [row.token_id]);
    // Any other outstanding links for this user are now pointless.
    await revokeUnusedTokens(client, row.user_id);
    return { id: row.user_id, email: row.email };
  });

  logger.info('Password setup completed', { userId: user.id });
  return user;
}

/**
 * Verifies credentials and opens a session. Unknown email, missing password and wrong password
 * all produce the same error and take roughly the same time.
 */
export async function login(email: string, password: string): Promise<{ user: SafeUser; session: CreatedSession }> {
  const user = await findUserByEmail(email);

  if (!user || !user.is_password_set || !user.password_hash) {
    await verifyAgainstDummyHash(password);
    logger.info('Login rejected', { reason: user ? 'password_not_set' : 'unknown_user', ...(user ? { userId: user.id } : {}) });
    throw Errors.invalidCredentials();
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    logger.info('Login rejected', { reason: 'wrong_password', userId: user.id });
    throw Errors.invalidCredentials();
  }

  const session = await createSession(user.id);
  logger.info('Login succeeded', { userId: user.id });
  return { user: { id: user.id, email: user.email }, session };
}

export async function logout(sessionId: string | undefined, userId?: number): Promise<void> {
  if (!sessionId) return;
  await deleteSession(sessionId);
  logger.info('Logout', userId !== undefined ? { userId } : {});
}
