import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

export const TEST_ADMIN_SECRET = 'test-admin-secret-0123456789-abcdefghijklmnop';
export const TEST_FRONTEND_URL = 'http://localhost:3000';

function readEnvFile(file: string): Record<string, string> {
  return existsSync(file) ? dotenv.parse(readFileSync(file)) : {};
}

/**
 * Points the app at a dedicated TEST database. Tests TRUNCATE tables, so this refuses to run
 * against the DATABASE_URL from .env. Every variable is set explicitly so nothing from .env
 * (real SMTP credentials, allowlists...) leaks into tests.
 */
export function applyTestEnv(): void {
  const fileEnv = readEnvFile('.env');
  const testUrl = process.env.TEST_DATABASE_URL || fileEnv.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Add it to .env (e.g. a Neon branch or a local Postgres). ' +
        'Tests delete data, so never point it at your real database.',
    );
  }
  if (fileEnv.DATABASE_URL === testUrl) {
    throw new Error('Refusing to run tests: TEST_DATABASE_URL is the same as DATABASE_URL in .env.');
  }

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: testUrl,
    DATABASE_POOL_MAX: '10',
    AUTO_MIGRATE: 'false',
    APP_NAME: 'Test Library',
    APP_URL: 'http://localhost:3000',
    FRONTEND_URL: TEST_FRONTEND_URL,
    SMTP_HOST: 'smtp.test.invalid',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM: 'Test Library <no-reply@test.invalid>',
    MAGIC_LINK_EXPIRY_MINUTES: '1440',
    EMAIL_BATCH_SIZE: '25',
    EMAIL_JOB_INTERVAL_MINUTES: '1',
    EMAIL_JOB_ENABLED: 'false',
    EMAIL_MAX_ATTEMPTS: '3',
    EMAIL_RECIPIENT_ALLOWLIST: '',
    ADMIN_SECRET: TEST_ADMIN_SECRET,
    SESSION_TTL_HOURS: '168',
    COOKIE_SAME_SITE: 'lax',
    COOKIE_DOMAIN: '',
    TRUST_PROXY: '0',
  });
}
