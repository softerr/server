# API Documentation

Machine-readable contract: [OpenAPI specification](openapi.yaml).

Base path:
- `/api`

Content type:
- PHP responses are JSON. Nginx redirects and errors (including some `413` and `429` responses) may not be JSON.

## 1. Health check

Endpoint:
- `GET /api/` (`/api` redirects to `/api/` through Nginx)

Success response:

```json
{
  "status": "ok",
  "message": "API is ready"
}
```

Errors:
- `405` with `{"error":"Method not allowed"}` for non-`GET` methods.
- `503` with `status: "unavailable"` when the verification URL, PostgreSQL connection, or required database schema is unavailable. Email transport delivery is handled by the background worker and is not checked here.

## 2. Signup

Endpoint:
- `POST /api/auth/signup`

Request body:

```json
{
  "username": "john",
  "password": "secret123",
  "email": "john@example.com"
}
```

Validation rules:
- `username`, `password`, `email` are required.
- `username` max length is `100` bytes after trimming.
- `password` max length is `1024` bytes.
- `email` must be a valid email format.
- `email` max length is `255` bytes after trimming and lowercasing.
- The signup request body must be at most `4096` bytes.
- Public signup requests are limited per client IP to 20 per minute, with a burst allowance of 20.
- `verified` is always controlled by backend (not accepted from user).

Timezone for verification email expiry is resolved automatically in this order:
1. `X-Timezone` request header (recommended, IANA timezone like `Europe/Vilnius`)
2. `Timezone` request header
3. `timezone` cookie
4. `timezone` field in request body (optional fallback)

If no client timezone is provided, email uses the token timestamp timezone as-is.

Success:
- `201 Created`

Example response:

```json
{
  "id": 1,
  "username": "john",
  "email": "john@example.com",
  "verified": false,
  "created": "2026-05-17 14:30:00",
  "verification_email_queued": true
}
```

`created` is a database timestamp without timezone information; clients should not treat it as UTC without an agreed timezone.

Side effects:
- Stores user in `public."user"`.
- Stores verification token in `public.user_token` (`type='verify'`).
- Queues a verification email in `public.verification_email_outbox` in the same transaction as the account and token.
- A background worker sends the email containing `/api/auth/verify?token=...&view=html`.

Common errors:
- `400 {"error":"Invalid JSON body"}`
- `400 {"error":"username, password and email are required"}`
- `400 {"error":"username must be at most 100 characters"}`
- `400 {"error":"password must be at most 1024 bytes"}`
- `400 {"error":"email must be at most 255 characters"}`
- `400 {"error":"email is invalid"}`
- `413` when the request body exceeds `4096` bytes
- `429` when the signup rate limit is exceeded
- `409 {"error":"username or email already exists"}`
- `500 {"error":"Database connection failed"}`
- `500 {"error":"DB_PASSWORD is not configured"}`
- `503 {"error":"Verification email is not configured"}` when `APP_BASE_URL` is missing or invalid

## 3. Resend verification email

Endpoint:
- `POST /api/auth/resend-verification`

Request body:

```json
{"email":"john@example.com"}
```

The email must be at most 255 bytes after trimming and lowercasing, and the request body must be at most 4096 bytes. Public resend requests are limited per client IP to 10 per minute, with a burst allowance of 10. Oversized email values return `400`, oversized bodies return `413`, and requests over the rate limit return `429`.

Returns `202 Accepted` with the same message whether the account exists, is already verified, or is eligible for another email. For an unverified account, a new request is allowed after one minute. A token with less than ten minutes remaining is replaced before queuing. The optional timezone inputs follow the signup rules above.
If `APP_BASE_URL` is missing or invalid, the endpoint returns `503` before accessing the database.

## 4. Verify account

Endpoint:
- `GET /api/auth/verify?token=<token>`

Token format:
- 64 hex characters.

Success:
- `200 OK`

Opening the email link shows an HTML page stating whether
verification succeeded or failed, with a link back to the quiz. API clients
receive the JSON responses below; send `Accept: application/json` explicitly
when requesting JSON without the email link's `view=html` parameter. Both
formats use the same HTTP status codes, and the verification response is not
cached.

Example response:

```json
{
  "id": 1,
  "username": "john",
  "email": "john@example.com",
  "verified": true,
  "created": "2026-05-17 14:30:00"
}
```

Behavior:
- Validates token from `public.user_token`.
- Token must still be unexpired when the account lock is acquired.
- Locks the account, rechecks the token, then marks the user as verified and deletes all verification tokens in one transaction. A token removed by a concurrent resend or another verification request is rejected.

Common errors:
- `400 {"error":"Invalid verification token"}`
- `400 {"error":"Verification token is invalid or expired"}`
- `500 {"error":"Failed to validate verification token"}`
- `500 {"error":"Failed to lock account for verification"}`
- `500 {"error":"Failed to verify account"}`
- `500 {"error":"Failed to finalize verification"}`

## 5. Login and sessions

`POST /api/auth/login` accepts JSON with `email` and `password`. Email is
trimmed and lowercased. Both fields must be strings and nonempty; email must
be valid and at most 255 bytes, password at most 1024 bytes, and the body at
most 4096 bytes. The account must have a verified email. The endpoint returns
`200` with the same user fields as verification and sets a `softerr_session`
cookie. Wrong email or password returns `401` with the same error message;
correct credentials for an unverified account return `403`. Invalid input
returns `400`. Nginx returns `429` when the per-IP limit of 10 requests per
minute plus a burst of 10 is exceeded.

The session cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/api/`, and
`Secure` on HTTPS. It is a browser-session cookie; the server expires the
session after two hours of inactivity. Web clients on the same origin send
it automatically. `GET /api/auth/me` returns the verified account for the
current session or `401` if unauthenticated. `POST /api/auth/logout` ends the
session and returns `200` even when no session exists. Native clients must
store and resend the cookie. No other API route currently requires login.

## 6. Password reset

`POST /api/auth/password-reset/request` accepts `{"email":"john@example.com"}`
and returns `202` with the same message for existing, unknown, unverified, and
recently requested accounts. A verified account can queue a reset email once
per ten minutes. Nginx also limits requests to 5 per minute per IP, plus a burst
of 5. The worker creates a 32-byte random token, stores only its SHA-256
digest, and emails a quiz link valid for 30 minutes. A retry creates a new
token and invalidates the previous link.

`POST /api/auth/password-reset/confirm` accepts a JSON object with a 64-character
hex `token` and a new `password`. The password must be nonempty and at most
1024 bytes, matching signup. The endpoint returns `200` after changing the
password, consuming all reset tokens, and queuing a change notification in
one transaction. Invalid, expired, and used links return `400`. Nginx limits
requests to 10 per minute per IP, plus a burst of 10. Existing login sessions
become invalid because each session is tied to the password hash from login.
The user must log in again; confirmation does not create a session.

Both request bodies are limited to 4096 bytes. The quiz has a forgot-password
form and a reset form opened by the emailed link. The link carries its token
in the URL fragment so the initial page request does not send it to Nginx.

## 7. Email delivery behavior

The `verification_email_queued` response field confirms that the job was committed to PostgreSQL. It does not mean the mail transport accepted or delivered the message. The systemd email worker checks the outbox every minute. It claims each job for 15 minutes, then sends without holding a database transaction open. The delivery schedule and claim are stored separately, so a resend during an active delivery leaves that claim intact; the in-flight delivery can satisfy the resend. Failed deliveries remain queued and are retried after two minutes while the token is valid. If the worker stops during delivery, the claim expires and the job becomes available again. Delivery may happen more than once if the worker stops after SMTP accepts a message but before it deletes the outbox row.

The worker uses SMTP when `SMTP_HOST` is configured and PHP `mail()` otherwise. An SMTP failure does not fall back to `mail()`. Verification or token expiry removes obsolete queued jobs. The client can request another attempt with `POST /api/auth/resend-verification` after the one-minute cooldown.

Both PHP-FPM and the systemd email worker receive these runtime env vars:

- `DB_HOST` (default `127.0.0.1`)
- `DB_PORT` (default `5432`)
- `DB_NAME` (default `auth`)
- `DB_USER` (default `auth_api`)
- `DB_PASSWORD` (required)
- `APP_BASE_URL` (required HTTPS origin for verification links; loopback HTTP is allowed for local tests)

Only the email worker receives the mail transport settings:

- `MAIL_FROM` (default `no-reply@localhost`)
- `SMTP_HOST` (optional, enables SMTP path)
- `SMTP_PORT` (optional, default `587`)
- `SMTP_ENCRYPTION` (optional: `tls`, `ssl`, `none`; default `tls`)
- `SMTP_USERNAME` (optional)
- `SMTP_PASSWORD` (required if `SMTP_USERNAME` is set)

## 8. Not found and method handling

Any unknown route under `/api`:
- `404 {"error":"Not found"}`

Known routes with wrong HTTP method:
- `405 {"error":"Method not allowed"}`

## 9. Automated endpoint tests

Check live responses against the OpenAPI specification from the host after
starting the local QEMU VM:

```bash
bash scripts/qemu.sh start
bash scripts/test_openapi.sh
```

The contract check sends a small number of signup, resend, login, and password
reset requests, so use the local test VM rather than production. It checks response status, content
type, and schema. It cannot create a valid one-time verification token, so run
the endpoint tests below for the full signup, verification, and session flow. If the VM
uses a different HTTP port, set `API_TEST_BASE_URL` to its local origin. The
generated data may produce schema-validation warnings for signup,
verification, and password reset confirmation even when the response checks
pass; inspect the reported status codes and use the endpoint tests to cover successful requests.

Run against local QEMU VM:

```bash
bash scripts/qemu.sh test-api
```

Local/server run:

```bash
sudo API_TEST_BASE_URL='http://127.0.0.1' bash scripts/test_api.sh
```

Optional test env vars:
- `API_TEST_BASE_URL` (default `http://127.0.0.1`)
- `API_TEST_DB_NAME` (default `auth`)
- `API_TEST_DB_SUPERUSER` (default `postgres`)
- `API_TEST_REQUIRE_DB` (`1` or `0`, default `1`)
- `API_TEST_REQUIRE_EMAIL` (`1` or `0`, default `1` in both `qemu.sh test-api` and `scripts/test_api.sh`)
- `API_TEST_MAILPIT_URL` (Mailpit origin; required for the full password reset email and session test)

GitHub workflow:
- `.github/workflows/test-api-runner.yml` (`Test API On Runner`) runs the OpenAPI contract check and endpoint tests for API, spec, and test-script changes.
- `.github/workflows/test-api-qemu.yml` (`Test API In QEMU`) runs the endpoint tests in a VM when dispatched.

How to add a new endpoint test:
1. Add a new case file in `tests/api/cases/` (for example `40-account-profile.sh`).
2. Define one or more `test_*` functions using helpers from `tests/api/lib.sh`.
3. Register each test with `register_test_case test_function_name`.
4. Workflow/local runner will auto-discover and execute it.
