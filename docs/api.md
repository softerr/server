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
