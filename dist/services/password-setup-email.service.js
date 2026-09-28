/**
 * Delivery of password-setup emails, shared by the background worker and the admin "resend"
 * endpoint.
 *
 * Concurrency model (safe with several server instances and across restarts):
 *  1. CLAIM — one short transaction selects eligible rows with FOR UPDATE SKIP LOCKED and stamps
 *     them with a claim id (a lease). Other workers skip locked rows and rows with a live lease.
 *  2. TOKEN — per user, a short transaction re-checks that we still own the claim, revokes old
 *     tokens and stores the hash of a new one.
 *  3. SEND — the email is sent with no transaction or row lock held.
 *  4. COMPLETE — on success setup_email_sent_at is set (only now); on failure the new token is
 *     revoked and the user is scheduled for a retry with exponential backoff.
 * If a worker dies between 1 and 4 its lease expires after CLAIM_LEASE_SECONDS and the user is
 * picked up again, so no user is ever lost.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { query, withTransaction } from '../config/database.js';
import { Errors } from '../utils/errors.js';
import { logger, maskEmail, serializeError } from '../utils/logger.js';
import { sendPasswordSetupEmail } from './email.service.js';
import { buildMagicLink, issuePasswordSetupToken, revokeUnusedTokens } from './token.service.js';
/** Must comfortably exceed the time to send one batch (SMTP timeouts are ≤ 30 s per message). */
export const CLAIM_LEASE_SECONDS = 15 * 60;
async function claimPendingUsers(claimId, options) {
    const allowlist = options.allowlist && options.allowlist.length > 0 ? options.allowlist : null;
    const result = await query(`WITH candidates AS (
       SELECT id
       FROM users
       WHERE is_password_set = FALSE
         AND setup_email_sent_at IS NULL
         AND setup_email_attempts < $2
         AND (setup_email_next_attempt_at IS NULL OR setup_email_next_attempt_at <= NOW())
         AND (setup_email_claimed_at IS NULL OR setup_email_claimed_at < NOW() - make_interval(secs => $3))
         AND ($4::text[] IS NULL OR email = ANY($4::text[]))
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE users u
     SET setup_email_claim_id = $5, setup_email_claimed_at = NOW()
     FROM candidates c
     WHERE u.id = c.id
     RETURNING u.id, u.email`, [options.batchSize, options.maxAttempts, CLAIM_LEASE_SECONDS, allowlist, claimId]);
    return result.rows;
}
/**
 * Issues a token and sends the email to a user we hold a claim on.
 * Returns true when the email was accepted by the transport.
 */
async function deliverToClaimedUser(user, claimId) {
    const issued = await withTransaction(async (client) => {
        const owned = await client.query(`SELECT 1 FROM users
       WHERE id = $1 AND setup_email_claim_id = $2 AND is_password_set = FALSE
       FOR UPDATE`, [user.id, claimId]);
        if (owned.rowCount === 0)
            return null; // lease lost or password already set meanwhile
        return issuePasswordSetupToken(client, user.id);
    });
    if (!issued) {
        logger.warn('Skipped setup email: claim no longer held', { userId: user.id });
        return false;
    }
    try {
        await sendPasswordSetupEmail({
            to: user.email,
            magicLink: buildMagicLink(issued.rawToken),
            expiresAt: issued.expiresAt,
        });
    }
    catch (error) {
        await recordFailure(user.id, claimId, error);
        return false;
    }
    await query(`UPDATE users
     SET setup_email_sent_at = NOW(),
         setup_email_attempts = setup_email_attempts + 1,
         setup_email_next_attempt_at = NULL,
         setup_email_last_error = NULL,
         setup_email_claim_id = NULL,
         setup_email_claimed_at = NULL
     WHERE id = $1 AND setup_email_claim_id = $2`, [user.id, claimId]);
    logger.info('Password setup email sent', { userId: user.id, to: maskEmail(user.email) });
    return true;
}
async function recordFailure(userId, claimId, error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    logger.error('Password setup email failed', { userId, error: serializeError(error) });
    try {
        await withTransaction(async (client) => {
            // The link in an email that never arrived must not stay valid.
            await revokeUnusedTokens(client, userId);
            // Exponential backoff: retry after 2, 4, 8, 16, ... minutes (capped at 6 hours).
            await client.query(`UPDATE users
         SET setup_email_attempts = setup_email_attempts + 1,
             setup_email_next_attempt_at = NOW() + make_interval(mins => LEAST(2 ^ (setup_email_attempts + 1), 360)::int),
             setup_email_last_error = $3,
             setup_email_claim_id = NULL,
             setup_email_claimed_at = NULL
         WHERE id = $1 AND setup_email_claim_id = $2`, [userId, claimId, message]);
        });
    }
    catch (dbError) {
        // The lease will expire and the user will be retried; nothing else to do here.
        logger.error('Could not record email failure', { userId, error: serializeError(dbError) });
    }
}
/** Claims up to `batchSize` pending users and emails each one. One user's failure never stops the rest. */
export async function processPendingSetupEmails(options = {}) {
    const resolved = {
        batchSize: options.batchSize ?? env.EMAIL_BATCH_SIZE,
        maxAttempts: options.maxAttempts ?? env.EMAIL_MAX_ATTEMPTS,
        allowlist: options.allowlist ?? env.EMAIL_RECIPIENT_ALLOWLIST,
    };
    const claimId = randomUUID();
    const users = await claimPendingUsers(claimId, resolved);
    const result = { claimed: users.length, sent: 0, failed: 0 };
    // Sequential on purpose: keeps SMTP load predictable and respects provider rate limits.
    for (const user of users) {
        try {
            if (await deliverToClaimedUser(user, claimId))
                result.sent++;
            else
                result.failed++;
        }
        catch (error) {
            // e.g. a DB error while issuing the token; the lease expiry makes the user eligible again.
            result.failed++;
            logger.error('Unexpected error processing setup email', { userId: user.id, error: serializeError(error) });
        }
    }
    return result;
}
/**
 * Admin resend: works for users whose email was already sent or who exhausted their retries.
 * Old links are invalidated. Throws 404 / 409 / 502 as appropriate.
 */
export async function resendPasswordSetupEmail(userId) {
    const claimId = randomUUID();
    const claim = await query(`WITH target AS (
       SELECT id, email, is_password_set,
              (setup_email_claimed_at IS NOT NULL
               AND setup_email_claimed_at >= NOW() - make_interval(secs => $3)) AS claimed
       FROM users WHERE id = $1
       FOR UPDATE
     ),
     claimed AS (
       UPDATE users u
       SET setup_email_claim_id = $2, setup_email_claimed_at = NOW()
       FROM target t
       WHERE u.id = t.id AND NOT t.is_password_set AND NOT t.claimed
       RETURNING u.id
     )
     SELECT t.id, t.email, t.is_password_set, t.claimed FROM target t`, [userId, claimId, CLAIM_LEASE_SECONDS]);
    const user = claim.rows[0];
    if (!user)
        throw Errors.notFound('User not found');
    if (user.is_password_set)
        throw Errors.conflict('User has already set a password');
    if (user.claimed)
        throw Errors.conflict('A setup email for this user is being sent right now. Try again shortly.');
    // A manual resend starts a fresh retry budget.
    await query('UPDATE users SET setup_email_attempts = 0, setup_email_next_attempt_at = NULL WHERE id = $1', [
        userId,
    ]);
    const delivered = await deliverToClaimedUser(user, claimId);
    if (!delivered)
        throw Errors.emailDeliveryFailed();
}
//# sourceMappingURL=password-setup-email.service.js.map