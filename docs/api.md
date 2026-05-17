# API Documentation

Base path:
- `/api`

Content type:
- All responses are JSON.

## 1. Health check

Endpoint:
- `GET /api`

Success response:

```json
{
  "status": "ok",
  "message": "API is working"
}
```

Errors:
- `405` with `{"error":"Method not allowed"}` for non-`GET` methods.

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
- `username` max length is `100`.
- `email` must be a valid email format.
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
  "created": "2026-05-17 14:30:00+00"
}
```

Side effects:
- Stores user in `public."user"`.
- Stores verification token in `public.user_token` (`type='verify'`).
- Sends verification email containing `/api/auth/verify?token=...`.

Common errors:
- `400 {"error":"Invalid JSON body"}`
- `400 {"error":"username, password and email are required"}`
- `400 {"error":"username must be at most 100 characters"}`
- `400 {"error":"email is invalid"}`
- `409 {"error":"username or email already exists"}`
- `500 {"error":"Failed to send verification email"}`
- `500 {"error":"Database connection failed"}`
- `500 {"error":"DB_PASSWORD is not configured"}`

## 3. Verify account

Endpoint:
- `GET /api/auth/verify?token=<token>`

Token format:
- 64 hex characters.

Success:
- `200 OK`

Example response:

```json
{
  "id": 1,
  "username": "john",
  "email": "john@example.com",
  "verified": true,
  "created": "2026-05-17 14:30:00+00"
}
```

Behavior:
- Validates token from `public.user_token`.
- Token must be unexpired (`expires > CURRENT_TIMESTAMP`).
- Marks user as verified and deletes token row.

Common errors:
- `400 {"error":"Invalid verification token"}`
- `400 {"error":"Verification token is invalid or expired"}`
- `500 {"error":"Failed to validate verification token"}`
- `500 {"error":"Failed to verify account"}`
- `500 {"error":"Failed to finalize verification"}`

## 4. Email delivery behavior

Signup email send order:
1. SMTP if `SMTP_HOST` is configured.
2. PHP `mail()` fallback if SMTP is not configured.

Relevant runtime env vars (from php-fpm):
- `DB_HOST` (default `127.0.0.1`)
- `DB_PORT` (default `5432`)
- `DB_NAME` (default `auth`)
- `DB_USER` (default `auth_api`)
- `DB_PASSWORD` (required)
- `MAIL_FROM` (default `no-reply@localhost`)
- `APP_BASE_URL` (optional)
- `SMTP_HOST` (optional, enables SMTP path)
- `SMTP_PORT` (optional, default `587`)
- `SMTP_ENCRYPTION` (optional: `tls`, `ssl`, `none`; default `tls`)
- `SMTP_USERNAME` (optional)
- `SMTP_PASSWORD` (required if `SMTP_USERNAME` is set)

## 5. Not found and method handling

Any unknown route under `/api`:
- `404 {"error":"Not found"}`

Known routes with wrong HTTP method:
- `405 {"error":"Method not allowed"}`

## 6. Automated endpoint tests

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

GitHub workflow:
- `.github/workflows/test-api-qemu.yml` (`Test API In QEMU`)

How to add a new endpoint test:
1. Add a new case file in `tests/api/cases/` (for example `40-password-reset.sh`).
2. Define one or more `test_*` functions using helpers from `tests/api/lib.sh`.
3. Register each test with `register_test_case test_function_name`.
4. Workflow/local runner will auto-discover and execute it.
