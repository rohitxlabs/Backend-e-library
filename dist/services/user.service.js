import { env } from '../config/env.js';
import { isPgError, PgErrorCode, pool, query } from '../config/database.js';
import { Errors } from '../utils/errors.js';
/** Must match the users_normalize_email() trigger in 001_create_users.sql. */
export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
export async function findUserByEmail(email) {
    const result = await query('SELECT id, email, password_hash, is_password_set FROM users WHERE email = $1', [normalizeEmail(email)]);
    return result.rows[0] ?? null;
}
export async function findUserById(id, db = pool) {
    const result = await db.query('SELECT id, email FROM users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
}
/** Creates a single user. Throws 409 if the (normalized) email already exists. */
export async function createUser(email) {
    try {
        const result = await query('INSERT INTO users (email) VALUES ($1) RETURNING id, email', [
            normalizeEmail(email),
        ]);
        return result.rows[0];
    }
    catch (error) {
        if (isPgError(error, PgErrorCode.UNIQUE_VIOLATION))
            throw Errors.conflict('Email already exists');
        throw error;
    }
}
/** Bulk insert that skips existing emails. Returns only the newly created users. */
export async function createUsers(emails) {
    const unique = [...new Set(emails.map(normalizeEmail))];
    if (unique.length === 0)
        return [];
    const result = await query(`INSERT INTO users (email)
     SELECT unnest($1::text[])
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`, [unique]);
    return result.rows;
}
// Shared by the admin list filter and the status column so both always agree.
// $1 is always EMAIL_MAX_ATTEMPTS.
const STATUS_SQL = `
  CASE
    WHEN is_password_set THEN 'password_set'
    WHEN setup_email_sent_at IS NOT NULL THEN 'sent'
    WHEN setup_email_attempts >= $1 THEN 'failed'
    ELSE 'pending'
  END`;
export async function listUsers(options) {
    const params = [env.EMAIL_MAX_ATTEMPTS];
    const conditions = [];
    if (options.status) {
        params.push(options.status);
        conditions.push(`(${STATUS_SQL}) = $${params.length}`);
    }
    if (options.search) {
        // Escape LIKE wildcards so user input is matched literally.
        params.push(`%${options.search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
        conditions.push(`email LIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(options.pageSize, (options.page - 1) * options.pageSize);
    const result = await query(`SELECT id, email, is_password_set, ${STATUS_SQL} AS status, setup_email_sent_at,
            setup_email_attempts, setup_email_last_error, created_at, updated_at,
            COUNT(*) OVER () AS total
     FROM users
     ${where}
     ORDER BY id
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return {
        total: Number(result.rows[0]?.total ?? 0),
        users: result.rows.map((row) => ({
            id: row.id,
            email: row.email,
            isPasswordSet: row.is_password_set,
            setupEmailStatus: row.status,
            setupEmailSentAt: row.setup_email_sent_at,
            setupEmailAttempts: row.setup_email_attempts,
            setupEmailLastError: row.setup_email_last_error,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
    };
}
export async function getEmailStatusCounts() {
    const result = await query(`SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NULL
                          AND setup_email_attempts < $1) AS pending,
       COUNT(*) FILTER (WHERE setup_email_sent_at IS NOT NULL) AS sent,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NULL
                          AND setup_email_attempts >= $1) AS failed,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NOT NULL) AS "awaitingPassword",
       COUNT(*) FILTER (WHERE is_password_set) AS "passwordsSet"
     FROM users`, [env.EMAIL_MAX_ATTEMPTS]);
    const row = result.rows[0];
    return {
        total: Number(row.total),
        pending: Number(row.pending),
        sent: Number(row.sent),
        failed: Number(row.failed),
        awaitingPassword: Number(row.awaitingPassword),
        passwordsSet: Number(row.passwordsSet),
    };
}
//# sourceMappingURL=user.service.js.map