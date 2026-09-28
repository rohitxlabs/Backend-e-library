# API reference

Base URL (development): `http://localhost:5000`

All responses are JSON in one of two shapes:

```json
{ "success": true, "data": { } }
{ "success": false, "message": "Human readable, safe to display" }
```

Validation failures add a field list:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "password", "message": "Password must contain a number" }]
}
```

## Using the API from a browser frontend

- Authentication is a session cookie (`sid`; `__Host-sid` in production). It is `HttpOnly`, so
  JavaScript cannot read it. The browser has to send it, so every request needs credentials enabled:
  - `fetch(url, { credentials: 'include' })`
  - axios: `axios.create({ baseURL, withCredentials: true })`
- The frontend origin must be listed in `FRONTEND_URL`. Other origins get no CORS headers, and
  their `POST` requests are rejected with `403`.
- Send bodies as `Content-Type: application/json`, 10 KB maximum.
- Rate-limited responses return `429` with `RateLimit` / `RateLimit-Policy` headers.

## Health

### `GET /health`

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "status": "ok", "database": "up", "uptimeSeconds": 42 } }` |
| 503 | `{ "success": false, "message": "Database unavailable" }` |

---

## Auth

### `GET /api/auth/verify-setup-token?token=<TOKEN>`

The frontend's `/set-password?token=...` page calls this on load to decide whether to show the
form or an "invalid or expired link" message. It does not consume the token.

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "valid": true } }` |
| 400 | `{ "success": false, "message": "Invalid or expired token" }`: unknown, malformed, expired, already used, or superseded by a newer link |
| 429 | Too many attempts (30 per 15 min per IP) |

### `POST /api/auth/set-password`

```json
{ "token": "<TOKEN from the URL>", "password": "NewPassword123!", "confirmPassword": "NewPassword123!" }
```

Password policy: 10–128 characters, with at least one lowercase letter, one uppercase letter, one
digit and one special character. No leading or trailing whitespace.

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "passwordSet": true } }`. Next, send the user to the login page. |
| 400 | `Invalid or expired token`, or `Validation failed` with `errors[]` (weak password, `confirmPassword` mismatch) |
| 429 | Too many attempts (10 per 15 min per IP) |

A token works once. If several requests arrive at the same time, exactly one succeeds.

### `POST /api/auth/login`

```json
{ "email": "user@example.com", "password": "NewPassword123!" }
```

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "id": 123, "email": "user@example.com" } }` plus `Set-Cookie` |
| 400 | `Validation failed` (malformed email or missing password) |
| 401 | `{ "success": false, "message": "Invalid email or password" }`. This is the same for an unknown email, a wrong password, and an account that has not set its password yet. |
| 429 | Too many attempts (10 per 15 min per IP, and 10 per 15 min per email) |

Sessions last `SESSION_TTL_HOURS` (7 days by default).

### `GET /api/auth/me`

Requires the session cookie.

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "id": 123, "email": "user@example.com" } }` |
| 401 | `{ "success": false, "message": "Authentication required" }` |

### `POST /api/auth/logout`

Deletes the session on the server and clears the cookie. Always returns
`200 { "success": true, "data": { "loggedOut": true } }`.

---

## Admin

Every `/api/admin/*` route requires one of these headers:

```
Authorization: Bearer <ADMIN_SECRET>
X-Admin-Secret: <ADMIN_SECRET>
```

Without a valid secret the response is `401 { "success": false, "message": "Unauthorized" }`.
Call these routes from a trusted backend or tool (curl, Postman). **Never put `ADMIN_SECRET` in
frontend code.**

### `GET /api/admin/users`

Query parameters, all optional:

| Name | Default | Notes |
| --- | --- | --- |
| `page` | 1 | |
| `pageSize` | 50 | max 100 |
| `status` | — | `pending`, `sent`, `failed` or `password_set` |
| `search` | — | substring match on email |

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": 1,
        "email": "user1@example.com",
        "isPasswordSet": false,
        "setupEmailStatus": "sent",
        "setupEmailSentAt": "2026-09-28T15:05:00.044Z",
        "setupEmailAttempts": 1,
        "setupEmailLastError": null,
        "createdAt": "2026-09-28T15:04:08.501Z",
        "updatedAt": "2026-09-28T15:05:00.044Z"
      }
    ],
    "pagination": { "page": 1, "pageSize": 50, "total": 1, "totalPages": 1 }
  }
}
```

`setupEmailStatus` values:

- `pending`: waiting for the worker. This includes users whose last attempt failed and who are
  scheduled for a retry.
- `sent`: the SMTP server accepted the email.
- `failed`: `EMAIL_MAX_ATTEMPTS` sends failed in a row. Use the resend endpoint.
- `password_set`: the user finished setup.

### `GET /api/admin/email-status`

```json
{
  "success": true,
  "data": { "total": 1000, "pending": 20, "sent": 975, "failed": 5, "awaitingPassword": 45, "passwordsSet": 930 }
}
```

`awaitingPassword` counts users whose email was sent but who have not set a password yet.

### `POST /api/admin/resend-password-setup/:userId`

Cancels the user's earlier links, issues a new one, emails it, and resets the automatic retry
counter.

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "data": { "sent": true } }` |
| 400 | `userId` is not a positive integer |
| 404 | `User not found` |
| 409 | `User has already set a password`, or the worker is sending to this user right now |
| 502 | `Failed to send email. Please try again later.` (the SMTP error is only in the server logs) |
| 429 | More than 30 resends per 15 min per IP |

---

## Suggested frontend flow

```
/set-password?token=abc
  ├─ on load:  GET  /api/auth/verify-setup-token?token=abc
  │              200 → show the form · 400 → show "link invalid or expired, contact support"
  └─ submit:   POST /api/auth/set-password { token, password, confirmPassword }
                 200 → redirect to /login

/login
  └─ submit:   POST /api/auth/login { email, password }   (credentials: 'include')
                 200 → redirect to the app

app shell
  ├─ on load:  GET  /api/auth/me   200 → signed in · 401 → redirect to /login
  └─ sign out: POST /api/auth/logout
```
