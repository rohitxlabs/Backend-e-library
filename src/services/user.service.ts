import { env } from '../config/env.js';
import { isPgError, PgErrorCode, pool, query, type Queryable } from '../config/database.js';
import { Errors } from '../utils/errors.js';

/** Must match the users_normalize_email() trigger in 001_create_users.sql. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface UserCredentialsRow {
  id: number;
  email: string;
  password_hash: string | null;
  is_password_set: boolean;
}

/** Public shape — never includes password or token hashes. */
export interface SafeUser {
  id: number;
  email: string;
}

export interface AdminUserView extends SafeUser {
  isPasswordSet: boolean;
  setupEmailStatus: SetupEmailStatus;
  setupEmailSentAt: Date | null;
  setupEmailAttempts: number;
  setupEmailLastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SetupEmailStatus = 'pending' | 'sent' | 'failed' | 'password_set';

export async function findUserByEmail(email: string): Promise<UserCredentialsRow | null> {
  const result = await query<UserCredentialsRow>(
    'SELECT id, email, password_hash, is_password_set FROM users WHERE email = $1',
    [normalizeEmail(email)],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: number, db: Queryable = pool): Promise<SafeUser | null> {
  const result = await db.query<SafeUser>('SELECT id, email FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

/** Creates a single user. Throws 409 if the (normalized) email already exists. */
export async function createUser(email: string): Promise<SafeUser> {
  try {
    const result = await query<SafeUser>('INSERT INTO users (email) VALUES ($1) RETURNING id, email', [
      normalizeEmail(email),
    ]);
    return result.rows[0]!;
  } catch (error) {
    if (isPgError(error, PgErrorCode.UNIQUE_VIOLATION)) throw Errors.conflict('Email already exists');
    throw error;
  }
}

/** Bulk insert that skips existing emails. Returns only the newly created users. */
export async function createUsers(emails: string[]): Promise<SafeUser[]> {
  const unique = [...new Set(emails.map(normalizeEmail))];
  if (unique.length === 0) return [];
  const result = await query<SafeUser>(
    `INSERT INTO users (email)
     SELECT unnest($1::text[])
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    [unique],
  );
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

export interface ListUsersOptions {
  page: number;
  pageSize: number;
  status?: SetupEmailStatus | undefined;
  search?: string | undefined;
}

export async function listUsers(options: ListUsersOptions): Promise<{ users: AdminUserView[]; total: number }> {
  const params: unknown[] = [env.EMAIL_MAX_ATTEMPTS];
  const conditions: string[] = [];
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

  const result = await query<{
    id: number;
    email: string;
    is_password_set: boolean;
    status: SetupEmailStatus;
    setup_email_sent_at: Date | null;
    setup_email_attempts: number;
    setup_email_last_error: string | null;
    created_at: Date;
    updated_at: Date;
    total: string;
  }>(
    `SELECT id, email, is_password_set, ${STATUS_SQL} AS status, setup_email_sent_at,
            setup_email_attempts, setup_email_last_error, created_at, updated_at,
            COUNT(*) OVER () AS total
     FROM users
     ${where}
     ORDER BY id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

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

export interface EmailStatusCounts {
  total: number;
  /** Waiting for the worker (includes users scheduled for a retry). */
  pending: number;
  /** Setup email delivered to the SMTP server. */
  sent: number;
  /** Gave up after EMAIL_MAX_ATTEMPTS failures — use the admin resend endpoint. */
  failed: number;
  /** Email sent but the user has not set a password yet. */
  awaitingPassword: number;
  passwordsSet: number;
}

export async function getEmailStatusCounts(): Promise<EmailStatusCounts> {
  const result = await query<Record<keyof EmailStatusCounts, string>>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NULL
                          AND setup_email_attempts < $1) AS pending,
       COUNT(*) FILTER (WHERE setup_email_sent_at IS NOT NULL) AS sent,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NULL
                          AND setup_email_attempts >= $1) AS failed,
       COUNT(*) FILTER (WHERE NOT is_password_set AND setup_email_sent_at IS NOT NULL) AS "awaitingPassword",
       COUNT(*) FILTER (WHERE is_password_set) AS "passwordsSet"
     FROM users`,
    [env.EMAIL_MAX_ATTEMPTS],
  );
  const row = result.rows[0]!;
  return {
    total: Number(row.total),
    pending: Number(row.pending),
    sent: Number(row.sent),
    failed: Number(row.failed),
    awaitingPassword: Number(row.awaitingPassword),
    passwordsSet: Number(row.passwordsSet),
  };
}
