/**
 * All outbound email goes through this module. To switch providers (SES, Resend, Postmark...),
 * replace the transporter here or pass any Nodemailer-compatible transporter to setEmailTransporter().
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env, isServerless } from '../config/env.js';
import { logger, serializeError } from '../utils/logger.js';

let transporter: Transporter | null = null;

function createSmtpTransporter(): Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    // On a long-running server, reuse a few SMTP connections for batch sends. On serverless hosts
    // the process is frozen between requests, which silently kills pooled sockets, so connect per email.
    pool: !isServerless,
    maxConnections: 3,
    maxMessages: 100,
    // Fail fast so a hung SMTP server cannot stall the worker past its claim lease.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // On port 587 (SMTP_SECURE=false) insist on STARTTLS so credentials are never sent in clear text.
    requireTLS: !env.SMTP_SECURE && env.NODE_ENV === 'production',
  });
}

/** The process-wide transporter, created lazily on first use and then reused. */
export function getEmailTransporter(): Transporter {
  transporter ??= createSmtpTransporter();
  return transporter;
}

/** Swap the transport (tests, or a different provider). Pass null to fall back to SMTP. */
export function setEmailTransporter(next: Transporter | null): void {
  transporter = next;
}

export async function verifyEmailTransport(): Promise<boolean> {
  try {
    await getEmailTransporter().verify();
    return true;
  } catch (error) {
    logger.warn('SMTP verification failed; emails will fail until this is fixed', {
      error: serializeError(error),
    });
    return false;
  }
}

export function closeEmailTransport(): void {
  transporter?.close();
  transporter = null;
}

export interface PasswordSetupEmailInput {
  to: string;
  magicLink: string;
  expiresAt: Date;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function describeDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

export function buildPasswordSetupEmail(input: PasswordSetupEmailInput): EmailContent {
  const appName = env.APP_NAME;
  const validity = describeDuration(env.MAGIC_LINK_EXPIRY_MINUTES);
  const expiresUtc = input.expiresAt.toUTCString();
  const app = escapeHtml(appName);
  const link = escapeHtml(input.magicLink);
  const email = escapeHtml(input.to);

  const subject = `Set up your ${appName} password`;

  const text = [
    `Hello,`,
    ``,
    `An account has been created for you on ${appName} (${input.to}).`,
    `To start using it, set your password by opening the link below:`,
    ``,
    input.magicLink,
    ``,
    `This link is valid for ${validity} (until ${expiresUtc}) and can be used only once.`,
    ``,
    `Security notice: ${appName} will never ask for your password by email. Do not forward this`,
    `email or share the link. If you did not expect this message, you can safely ignore it.`,
    ``,
    `— The ${appName} team`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#1e3a8a;padding:24px 32px;color:#ffffff;font-size:20px;font-weight:600;">${app}</td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;">Hello,</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            An account has been created for you on <strong>${app}</strong> using <strong>${email}</strong>.
            To start using it, please set your password.
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
            <tr><td style="border-radius:6px;background:#2563eb;">
              <a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Set Password</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">If the button does not work, copy and paste this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${link}" style="color:#2563eb;">${link}</a></p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;">
            This link is valid for <strong>${escapeHtml(validity)}</strong> (until ${escapeHtml(expiresUtc)}) and can be used only once.
          </p>
          <div style="padding:16px;border-left:4px solid #f59e0b;background:#fffbeb;font-size:13px;line-height:1.6;color:#78350f;">
            <strong>Security notice:</strong> ${app} will never ask for your password by email.
            Do not forward this email or share the link. If you did not expect this message, you can safely ignore it.
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f9fafb;font-size:12px;color:#6b7280;">
          This is an automated message from ${app}. Please do not reply.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

/** Throws if the transport rejects the message; callers decide whether to retry. */
export async function sendPasswordSetupEmail(input: PasswordSetupEmailInput): Promise<void> {
  const content = buildPasswordSetupEmail(input);
  await getEmailTransporter().sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}
