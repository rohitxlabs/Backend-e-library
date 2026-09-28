# E-Library Auth API

A REST API built with Node.js, TypeScript, Express, PostgreSQL (NeonDB), Nodemailer and Argon2id.
Add user emails to the `users` table and the backend sends each new user a one-time
password-setup link on its own. Users then set a password and log in.

```
INSERT INTO users (email) ...          (manual, e.g. in the Neon SQL editor)
  → background worker (every minute) claims pending users in batches
  → random 256-bit token; only SHA-256(token) is stored, with an expiry
  → Nodemailer sends ${APP_URL}/set-password?token=<RAW_TOKEN>
  → setup_email_sent_at is set only after the SMTP server accepts the email
  → frontend page calls GET /api/auth/verify-setup-token, then POST /api/auth/set-password
  → Argon2id hash stored, token marked used (atomic, single use)
  → POST /api/auth/login → HTTP-only session cookie
```

The endpoints are documented in [docs/API.md](docs/API.md).

## Quick start

```bash
npm install
# create .env with at least the required variables below
npm run email:verify-smtp # optional: checks the SMTP login without sending anything
npm run dev
```

### Environment variables

`.env` is git-ignored. On a new machine or a hosting provider, set these variables. The server
validates them at startup and names any that are missing or invalid, without printing values.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Neon connection string (keep `sslmode`) |
| `APP_URL` | yes | — | Frontend base URL for magic links: `${APP_URL}/set-password?token=…` |
| `FRONTEND_URL` | yes | — | CORS allow-list, comma separated; never `*` |
| `SMTP_HOST` | yes | — | |
| `SMTP_FROM` | yes | — | e.g. `E-Library <no-reply@example.com>` |
| `SMTP_USER` / `SMTP_PASSWORD` | in production | — | set both or neither |
| `ADMIN_SECRET` | yes | — | at least 32 characters. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NODE_ENV` | | `development` | `production` requires https URLs |
| `PORT` | | `5000` | |
| `APP_NAME` | | `E-Library` | shown in emails |
| `SMTP_PORT` / `SMTP_SECURE` | | `465` / `true` | use `587` / `false` for STARTTLS |
| `MAGIC_LINK_EXPIRY_MINUTES` | | `1440` | 24 hours |
| `EMAIL_BATCH_SIZE` | | `25` | users emailed per worker run |
| `EMAIL_JOB_INTERVAL_MINUTES` | | `1` | |
| `EMAIL_JOB_ENABLED` | | `true` | `false` stops all automatic sending |
| `EMAIL_MAX_ATTEMPTS` | | `5` | after this many failures the user needs a manual resend |
| `EMAIL_RECIPIENT_ALLOWLIST` | | empty | if set, the worker emails **only** these addresses |
| `SESSION_TTL_HOURS` | | `168` | 7 days |
| `COOKIE_SAME_SITE` | | `lax` | `none` when frontend and API are on different sites |
| `COOKIE_DOMAIN` | | empty | |
| `TRUST_PROXY` | | `0` | `1` behind one reverse proxy or PaaS load balancer |
| `AUTO_MIGRATE` | | `true` | apply pending migrations on startup |
| `DATABASE_POOL_MAX` | | `10` | |
| `LOG_LEVEL` | | `info` | `debug`, `info`, `warn`, `error` or `silent` |
| `TEST_DATABASE_URL` | for `npm test` | — | separate database; tests delete data |

On startup the server connects to the database, applies any pending migrations
(`AUTO_MIGRATE=true`), verifies SMTP, starts the API on `PORT`, and starts the email worker.

To run migrations by hand: `npm run migrate`, or `npm run migrate:prod` after `npm run build`.

> npm 11 may print `allow-scripts` warnings for `argon2` and `esbuild` during install. Both work
> without running their install scripts (argon2 ships prebuilt binaries), so you can ignore the
> warnings.

## First run: test with 3–5 users before emailing everyone

1. In `.env`, set a small batch size and an allowlist of addresses you control:
   ```
   EMAIL_BATCH_SIZE=5
   EMAIL_RECIPIENT_ALLOWLIST=you@yourmail.com,colleague@yourmail.com
   ```
   While the allowlist is set, the worker emails **only** these addresses, even if the table
   already holds 1,000 users.
2. Add those users, either in the Neon SQL editor or with the helper script:
   ```sql
   INSERT INTO users (email) VALUES ('you@yourmail.com'), ('colleague@yourmail.com');
   ```
   ```bash
   npm run users:add -- you@yourmail.com colleague@yourmail.com
   ```
3. Run `npm run dev` and wait up to a minute. You can also send one batch right away with
   `npm run email:send-once`.
4. Open the link. Until the frontend exists, call the API directly:
   ```bash
   TOKEN=...   # copied from the link in the email
   curl "http://localhost:5000/api/auth/verify-setup-token?token=$TOKEN"
   curl -X POST http://localhost:5000/api/auth/set-password -H 'Content-Type: application/json' \
     -d "{\"token\":\"$TOKEN\",\"password\":\"NewPassword123!\",\"confirmPassword\":\"NewPassword123!\"}"
   curl -c jar -X POST http://localhost:5000/api/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"you@yourmail.com","password":"NewPassword123!"}'
   curl -b jar http://localhost:5000/api/auth/me
   ```
5. Check progress:
   ```bash
   curl -H "Authorization: Bearer $ADMIN_SECRET" http://localhost:5000/api/admin/email-status
   ```
6. When you are happy with the result, clear `EMAIL_RECIPIENT_ALLOWLIST`, set `EMAIL_BATCH_SIZE`
   back (default 25), and restart. The worker then works through the remaining users, one batch
   per minute (1,000 users take about 40 minutes at 25 per minute).

**SMTP sending limits:** a personal Gmail account allows about 500 emails per day and requires
an App Password. For 1,000+ users, use a transactional provider such as Amazon SES, Postmark,
Resend, Brevo or Mailgun, all of which offer SMTP credentials. Set `EMAIL_BATCH_SIZE` to stay
under your provider's per-minute limit.

## How the worker stays safe

- **No duplicate emails across instances or restarts.** Each batch is claimed with
  `SELECT … FOR UPDATE SKIP LOCKED` inside an `UPDATE`. The claim stamps each row with a claim id
  and time (a 15-minute lease). Other workers skip claimed rows, and emails are sent with no
  transaction or lock held.
- **Marked as sent only after delivery.** `setup_email_sent_at` is set after Nodemailer reports
  success.
- **Failures are isolated and retried.** If one address fails, the rest of the batch continues.
  The failed user's new token is revoked, and the user is retried after 2, 4, 8… minutes. After
  `EMAIL_MAX_ATTEMPTS` failures the user shows as `failed`, and an admin can use
  `POST /api/admin/resend-password-setup/:userId`.
- **Crash recovery.** If the process dies mid-batch, the lease expires and those users are picked
  up again. The one edge case is a crash in the instant between SMTP accepting a message and the
  database update. That user can then receive a second email, and only the newest link works.

## Security summary

| Concern | Implementation |
| --- | --- |
| Passwords | Argon2id (64 MiB, t=3, p=4); never logged or returned |
| Magic-link tokens | `crypto.randomBytes(32)`; only SHA-256 stored; expire (24 h by default); single use via row lock; superseded when a new link is issued |
| Sessions | random 256-bit id in an `HttpOnly` cookie (`Secure` and `__Host-` prefix in production); only its hash is stored; logout deletes it on the server |
| Account enumeration | login returns the same 401 and takes about the same time (a dummy Argon2 verify) for unknown, unfinished and wrong-password accounts |
| CSRF | SameSite cookies, a strict CORS allow-list, and an `Origin` check on state-changing requests |
| Brute force | per-IP and per-account login limits; limits on token and set-password endpoints; a global API limit |
| SQL injection | parameterized queries only |
| Input | Zod validation, 10 KB JSON limit |
| Errors | central handler; database errors and stack traces never reach clients |
| Logs | structured JSON; emails masked (`jo***@example.com`); sensitive keys redacted as a safety net |
| Headers | Helmet |
| Admin | shared secret (at least 32 characters) compared in constant time; swappable `AdminAuthenticator` for a future roles system |

### Production checklist

- `NODE_ENV=production`. The app then refuses to start unless `APP_URL` and `FRONTEND_URL` use
  `https://`.
- Run behind HTTPS, and set `TRUST_PROXY=1` when behind a reverse proxy or a PaaS load balancer.
- If the frontend and API are on different sites (for example `app.vercel.app` and
  `api.onrender.com`), set `COOKIE_SAME_SITE=none`. The simplest setup is to serve both from one
  site, such as `app.example.com` and `api.example.com`, and keep `lax`.
- With more than one API instance, move the rate-limit store to Redis
  (`src/middleware/rate-limit.middleware.ts`). The email worker is already multi-instance safe.
- Keep `.env` out of git; it is already in `.gitignore`. Rotate any secret that was ever
  committed or shared.

## Tests

The tests need a **dedicated** Postgres database, because they truncate tables. They refuse to
run against the `DATABASE_URL` in `.env`.

```bash
# in .env
TEST_DATABASE_URL=postgresql://ro@localhost:5432/elibrary_test
# local:  brew services start postgresql@14 && createdb elibrary_test
# or a Neon branch: Neon console → Branches → Create branch → copy its connection string

npm test
npm run typecheck
```

The suites in `tests/`:

- `database.test.ts`: connection, migrations, user creation, email normalization, duplicate
  emails.
- `crypto.test.ts`: token generation and hashing, Argon2id, the magic link.
- `email.test.ts`: email content, sending, send failure.
- `worker.test.ts`: batch processing, storing only the hash, failure isolation, retry after
  failure, max attempts, concurrent workers, lease expiry, the allowlist.
- `auth.test.ts`: valid, invalid, expired and used tokens; password mismatch; weak passwords;
  successful setup; token reuse; concurrent use of one token; login success and failure;
  `/me`; logout; expired sessions.
- `admin.test.ts`: unauthorized requests, users list, email status, resend.
- `security.test.ts`: rate limiting, CORS, the Origin check, Helmet, health, malformed and
  oversized bodies.

Emails in tests go through a real Nodemailer transporter with an in-memory transport, so the
tests never send real mail.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server with reload (tsx watch) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run migrate` / `migrate:prod` | Apply pending SQL migrations |
| `npm run users:add -- a@x.com b@x.com` | Insert users (existing emails are skipped) |
| `npm run email:send-once` | Process one email batch now and exit |
| `npm run email:verify-smtp` | Check the SMTP settings without sending |
| `npm test` / `npm run typecheck` | Run the tests / type-check the sources and tests |

## Project structure

```
src/
├── app.ts                         Express app: security middleware, routes, error handling
├── server.ts                      Startup, worker, graceful shutdown (SIGINT/SIGTERM)
├── config/        env.ts (Zod-validated), database.ts (pg Pool, transactions)
├── controllers/   auth, admin, health
├── services/      auth, user, token, session, email (Nodemailer), password-setup-email (claim/deliver)
├── routes/        auth.routes.ts, admin.routes.ts
├── middleware/    auth, admin, error, rate-limit, security (Origin check, no-store)
├── validators/    auth.validator.ts, admin.validator.ts (Zod)
├── jobs/          password-setup-email.job.ts (node-cron)
├── db/            migrate.ts, migrations/001–004 *.sql
├── scripts/       migrate, add-users, send-setup-emails-once, verify-smtp
└── utils/         crypto, logger, errors, http, session-cookie
tests/             Vitest and Supertest suites
docs/API.md        Endpoint reference for the frontend
```

### Migrations

| File | Contents |
| --- | --- |
| `001_create_users.sql` | `users` table as specified, plus an email-normalization trigger, an `updated_at` trigger, an email-format check, and a partial index on pending users |
| `002_create_password_setup_tokens.sql` | tokens table, with indexes on `user_id`, unused tokens, and `expires_at` |
| `003_add_setup_email_delivery_tracking.sql` | worker columns: claim lease, attempts, next retry, last error |
| `004_create_user_sessions.sql` | server-side sessions, storing only the hash of each session id |

Applied migrations are recorded in `schema_migrations`. Never edit a migration that has already
run; add a new numbered file instead.
# Backend-e-library
