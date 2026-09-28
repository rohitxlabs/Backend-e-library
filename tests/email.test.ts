import { afterAll, describe, expect, it } from 'vitest';
import { buildPasswordSetupEmail, sendPasswordSetupEmail, setEmailTransporter } from '../src/services/email.service.js';
import { FakeMailer } from './helpers.js';

afterAll(() => setEmailTransporter(null));

const input = {
  to: 'user@example.com',
  magicLink: 'http://localhost:3000/set-password?token=abc_DEF-123',
  expiresAt: new Date('2030-01-01T00:00:00Z'),
};

describe('password setup email content', () => {
  const email = buildPasswordSetupEmail(input);

  it('contains the required parts', () => {
    expect(email.subject).toBe('Set up your Test Library password');
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Test Library');
      expect(body).toContain('Hello');
      expect(body).toContain(input.magicLink);
      expect(body).toContain('1 day');
      expect(body).toMatch(/Security notice/);
      expect(body).toMatch(/only once/);
    }
    expect(email.html).toContain('>Set Password</a>');
  });

  it('never contains a password', () => {
    expect(email.text.toLowerCase()).not.toMatch(/your password is/);
  });

  it('escapes HTML in interpolated values', () => {
    const evil = buildPasswordSetupEmail({ ...input, to: '<script>@x.com' });
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('&lt;script&gt;');
  });
});

describe('sending', () => {
  it('sends through the configured transporter', async () => {
    const mailer = new FakeMailer().install();
    await sendPasswordSetupEmail(input);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: input.to, subject: 'Set up your Test Library password' });
  });

  it('rejects when the transport fails', async () => {
    const mailer = new FakeMailer().install();
    mailer.failFor.add(input.to);
    await expect(sendPasswordSetupEmail(input)).rejects.toThrow('550 Mailbox unavailable');
    expect(mailer.sent).toHaveLength(0);
  });
});
