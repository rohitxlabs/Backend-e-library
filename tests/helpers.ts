import nodemailer from 'nodemailer';
import { afterAll, beforeEach } from 'vitest';
import { closePool, pool, withTransaction } from '../src/config/database.js';
import { setEmailTransporter } from '../src/services/email.service.js';
import { issuePasswordSetupToken } from '../src/services/token.service.js';
import { createUser } from '../src/services/user.service.js';
import { hashPassword } from '../src/utils/crypto.js';
import { TEST_ADMIN_SECRET, TEST_CRON_SECRET, TEST_FRONTEND_URL } from './setup/test-env.js';

export { TEST_ADMIN_SECRET, TEST_CRON_SECRET, TEST_FRONTEND_URL };
export const STRONG_PASSWORD = 'NewPassword123!';

export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE users, password_setup_tokens, user_sessions RESTART IDENTITY CASCADE');
}

export interface CapturedMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * A real Nodemailer transporter with an in-memory transport: messages go through Nodemailer's
 * pipeline but are captured instead of sent. Recipients in `failFor` are rejected like an SMTP error.
 */
export class FakeMailer {
  readonly sent: CapturedMail[] = [];
  readonly failFor = new Set<string>();
  delayMs = 0;

  readonly transporter = nodemailer.createTransport({
    name: 'fake',
    version: '1.0.0',
    send: (mail, callback) => {
      const data = mail.data as { to: string; subject: string; text: string; html: string };
      setTimeout(() => {
        if (this.failFor.has(data.to)) {
          callback(new Error('550 Mailbox unavailable'), undefined as never);
          return;
        }
        this.sent.push({ to: data.to, subject: data.subject, text: data.text, html: data.html });
        callback(null, { envelope: mail.message.getEnvelope(), messageId: mail.message.messageId() } as never);
      }, this.delayMs);
    },
  });

  install(): this {
    setEmailTransporter(this.transporter);
    return this;
  }

  /** Extracts the raw token from the magic link in the latest email sent to `to`. */
  tokenFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    if (!mail) throw new Error(`No email sent to ${to}`);
    const match = mail.text.match(/\/set-password\?token=([A-Za-z0-9_-]+)/);
    if (!match?.[1]) throw new Error('No magic link in email');
    return match[1];
  }
}

/** Registers the common per-file lifecycle: clean DB + fresh fake mailer before each test. */
export function useTestDatabase(): { mailer: () => FakeMailer } {
  let mailer = new FakeMailer();
  beforeEach(async () => {
    await resetDatabase();
    mailer = new FakeMailer().install();
  });
  afterAll(async () => {
    setEmailTransporter(null);
    await closePool();
  });
  return { mailer: () => mailer };
}

/** Creates a user and a setup token directly (bypassing email). */
export async function createUserWithToken(email: string, expiryMinutes?: number) {
  const user = await createUser(email);
  const { rawToken } = await withTransaction((client) => issuePasswordSetupToken(client, user.id, expiryMinutes));
  return { user, rawToken };
}

/** Creates a user who already completed password setup. */
export async function createActiveUser(email: string, password = STRONG_PASSWORD) {
  const user = await createUser(email);
  await pool.query('UPDATE users SET password_hash = $2, is_password_set = TRUE WHERE id = $1', [
    user.id,
    await hashPassword(password),
  ]);
  return user;
}
