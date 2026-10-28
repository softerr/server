# API Documentation

Machine-readable contract: [OpenAPI specification](openapi.yaml).

Base path:
- `/api`

Content type:
- PHP responses are JSON. Nginx redirects and errors (including some `413` and `429` responses) may not be JSON.

The API uses separate PHP entrypoints: `/api/auth/*` is handled by the shared
auth app, `/api/quiz/*` by the quiz app, `/api/media/*` by the shared media app,
and `/api/` by the readiness endpoint.
The PHP files are internal to Nginx and are not public API URLs.

## Quiz library

Quiz app routes use `/api/quiz/`; shared account routes use `/api/auth/`.

These routes require the `softerr_session` cookie from a successful login. The
quiz app sends it automatically on same-origin requests. Account identities
live in the shared `auth` database. The `quiz` database has its own `user`
table, whose `auth_user_id` maps to the shared account. Each quiz has a foreign
key to its local user. The API creates the local user on the first quiz create.

- `GET /api/quiz/quizzes` returns `{ "quizzes": [...] }`, newest first. Each quiz has
  `id`, `name`, `description`, and `created` fields.
- `GET /api/quiz/quizzes/{quizId}` returns one owned quiz. A missing or other
  account's quiz returns `404`.
- `POST /api/quiz/quizzes` with `{ "name": "Geography" }` creates a quiz and returns
  the quiz with HTTP `201`. The name is trimmed and must be 1–100 bytes. Optional
  `description` is trimmed and limited to 1000 bytes. The request body must be
  at most 4096 bytes. An account may have 100 quizzes; further creation returns `409`.
- `POST /api/quiz/quizzes/import` accepts version 1 quiz JSON or ZIP and creates
  a new quiz with its questions in order. The request is limited to 48 MiB and
  100 questions. Send JSON as `application/json` or ZIP bytes as
  `application/octet-stream` (also accepts `application/zip`). The import is
  atomic: an invalid question, image, or archive leaves no partial quiz. It
  returns the new quiz with HTTP `201`; a full library returns `409`.
- `GET /api/quiz/quizzes/{quizId}/export.zip` downloads an owned quiz as ZIP.
  The archive contains `quiz.json` and used images under `images/{imageId}/`
  with their original filenames.
- `PATCH /api/quiz/quizzes/{quizId}` updates an owned quiz and returns it. `name`
  is required; an omitted `description` retains its value. A
  missing or other account's quiz returns `404`.
- `DELETE /api/quiz/quizzes/{quizId}` deletes an owned quiz and returns `204` with
  no body. Its questions are deleted too. A missing or other account's quiz returns `404`.
- `GET /api/quiz/quizzes/{quizId}/questions` returns `{ "questions": [...] }` in
  saved order. New questions appear last.
- `POST /api/quiz/quizzes/{quizId}/questions` adds a question and returns it with
  HTTP `201`. Each quiz may have 100 questions; further creation returns `409`.
- `PATCH /api/quiz/quizzes/{quizId}/questions/{questionId}` replaces a question's
  prompt, template, and config and returns the updated question.
- `PUT /api/quiz/quizzes/{quizId}/questions/order` accepts
  `{ "question_ids": [3, 2, 1] }` and returns the same object. Include every
  question ID exactly once. Unknown, missing, or stale IDs return `409`.
- `DELETE /api/quiz/quizzes/{quizId}/questions/{questionId}` returns `204` with no body.
  Question endpoints return `404` for quizzes or questions owned by another account.
- `GET /api/media/images` lists reusable shared and personal images by filename
  (case-insensitive) within each group. `scope` is `shared` or `personal`.
  Image metadata includes pixel `width` and `height` and stored `size_bytes`.
  Usage (`count` and `bytes`) and limits (`count`, `bytes`, and
  `per_image_bytes`) apply to personal images only.
- `GET /api/media/my-images` lists only the signed-in user's personal images.
  Published images appear in the shared library instead of My uploads.
- `GET /api/media/shared-images` lists every shared image, including its
  `group_id` (`null` for ungrouped images). The Home Media page shows groups as
  folders and opens a folder to show its images.
- Admins can upload images directly into the ungrouped shared library with
  `POST /api/media/shared-images`, or into a folder with
  `POST /api/media/groups/{groupId}/images`. Use the same raw image body and
  `X-Image-Name` header as personal uploads. Shared uploads do not use personal
  storage. Reuploading identical bytes to the same destination returns the
  existing image with HTTP `200`; an existing shared image in another folder
  returns `409` so the upload cannot move it unexpectedly.
- `GET /api/media/groups` lists shared folders with image counts and a cover
  image ID. Any authenticated user can browse them.
- Admins can create a folder with `POST /api/media/groups` and
  `{ "name": "Nature" }`, rename it with `PATCH /api/media/groups/{groupId}`
  and the same body, or delete it with `DELETE /api/media/groups/{groupId}`.
  Names are unique without regard to case and limited to 100 UTF-8 bytes.
  Deleting a folder leaves its images in the ungrouped area.
- Admins can move any shared image with
  `PATCH /api/media/images/{imageId}/group` and
  `{ "group_id": 12 }`. Send `null` to ungroup it. Image IDs and quiz references
  do not change when images move.
- `POST /api/media/images` accepts raw PNG, JPEG, or WebP bytes and returns image
  metadata with HTTP `201`. Each image is limited to 2 MiB and 4096 pixels per
  side. Send the original filename in the required `X-Image-Name` header, encoded
  with `encodeURIComponent` or equivalent. Names may be up to 255 UTF-8 bytes and
  cannot contain path separators or control characters. Personal storage is limited
  to 256 images and 32 MiB across apps. Uploading identical bytes again returns
  an existing personal or shared image ID and its first uploaded name. A shared
  match does not consume personal storage.
- `POST /api/media/images/{imageId}/publish` requires an admin session and an
  image in that admin's personal library. It makes the image available to all
  authenticated users while keeping its ID and original uploader. The image
  stops counting toward personal storage. It returns `409` if its bytes are
  already shared.
- `GET /api/media/images/{imageId}` returns original bytes to the owner or any
  authenticated user for a shared image.
- `DELETE /api/media/images/{imageId}` deletes only a personal image. It returns
  `204` if unused, or
  `409` if a saved question still references it. Removing an image from one
  question does not remove it from another.

The legacy `/api/quiz/images` routes continue to serve the same media library
for clients deployed before this change. New clients should use `/api/media/images`.

The quiz editor's **Export JSON** button downloads the saved quiz as a portable
document with `format: "softerr-quiz"`, `version: 1`, `name`, `description`, and
an ordered `questions` array. Each question contains `template`, `prompt`, and
`config`. Used images appear once in the `images` array with their original name
and base64 data and are
relinked to the importing account or matched to a published shared image by
content. **Export ZIP** stores the same quiz data in
`quiz.json`, with each used image in a separate file referenced by the
manifest's `images` array. Its `name` field preserves the original filename;
image IDs keep archive paths unique. Save pending edits before exporting. The library's
**Import JSON/ZIP** button creates a new quiz; it does not replace an existing
quiz. Only version 1 exports are accepted.

Import accepts up to 4096 image entries within the 48 MiB request limit.
Published shared matches do not use personal image count or storage quota;
unmatched images are added to the user's personal library and do use it.

Question create and update bodies require `template`, `prompt`, and `config`.
The prompt is trimmed and limited to 500 bytes. Text inside `config` is trimmed.
Question create and update JSON requests are limited to 32768 bytes. Lists have
no fixed maximum row count; the request size and the 500-byte prompt bound them.
Each returned question has
`id`, `quiz_id`, `template`, `prompt`, `config`, and `created`.

| Template | `config` | Rule |
| --- | --- | --- |
| `multiple_choice` | `{"options":[{"text":"A","correct":true},{"text":"B","correct":false}]}` | At least 2 options; at least one correct. Users may select multiple answers. |
| `one_choice` | Same shape as `multiple_choice` | At least 2 options; exactly one correct. |
| `number` | `{"answer":"42.5"}` | Decimal number as a string, up to 64 bytes. |
| `short_answer` | `{"answer":"Paris"}` | Nonempty answer, up to 500 bytes. |
| `open` | `{"sample_answer":"Explain..."}` | Optional sample answer, up to 1000 bytes; free-form response. |
| `true_false` | `{"answer":true}` | Boolean answer. |
| `yes_no` | `{"answer":false}` | Boolean answer. |
| `show_answer` | `{"answer":"The answer"}` | Nonempty answer to reveal, up to 1000 bytes. |
| `no_answer` | `{}` | Question only. |
| `match` | `{"pairs":[{"keyword":"France","definition":"Paris"},{"keyword":"Italy","definition":"Rome"}]}` | At least 2 pairs. |
| `ordering` | `{"items":[{"text":"Wash"},{"text":"Cut"},{"text":"Cook"}]}` | At least 2 distinct items, listed in the correct order. |
| `fill_blanks` | `{"answers":[{"text":"Paris"},{"text":"Rome"}]}` | Put `{{1}}`, `{{2}}`, etc. in `prompt`, each exactly once. The answer array follows marker order; at least 1 blank. |
| `categorize` | `{"categories":[{"name":"Mammals","items":[{"text":"Dog"}]},{"name":"Birds","items":[{"text":"Eagle"}]}]}` | At least 2 distinct categories, each with at least 1 item; all items must be distinct. |

Any question may include `image_id` for the prompt and `answer_image_id` for
the answer in `config`. Choice options may include their own `image_id`.
Match pairs may include `keyword_image_id` and `definition_image_id`, and
categories may include `name_image_id`. Ordering items, blank answers, and
category items are objects such as
`{"text":"Dog","image_id":12}`. A field with its own image may have empty
text. Image IDs must belong to the current account; the same ID may be used
in multiple fields and questions.

Choice option text is limited to 150 bytes; match keywords and definitions
are limited to 150 bytes each and require text or an image. Ordering items
and blank answers are also limited to 150 bytes;
category names are limited to 100 bytes and category items to 150 bytes. The
order of choice options, match pairs, and ordering items follows their array
order in `config`. The answer configs are stored with the question; the current
editor creates and edits questions, while quiz-taking behavior is not yet available.

Run **Setup PostgreSQL On Server** so the media image tables and grants exist,
then **Setup Nginx On Server** to install PHP ZIP support. Run **Deploy Apps On
Server** with `all` to publish the API and quiz app.

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
  "role": "user",
  "verified": false,
  "approved": false,
  "created": "2026-05-17 14:30:00",
  "verification_email_queued": true
}
```

`role` is assigned by the server. Signup always creates a `user`; the other
available roles are `mod` and `admin`. Clients cannot choose a role at signup.
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
verification succeeded or failed, with a link back to the home app. API clients
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
  "role": "user",
  "verified": true,
  "approved": false,
  "created": "2026-05-17 14:30:00"
}
```

Behavior:
- Validates token from `public.user_token`.
- Token must still be unexpired when the account lock is acquired.
- Locks the account, rechecks the token, then marks the user as verified and deletes all verification tokens in one transaction. A token removed by a concurrent resend or another verification request is rejected.
- Queues one approval notice for each active admin in the same transaction. The email worker delivers these notices; verification does not wait for SMTP.

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
most 4096 bytes. The account must have a verified email and admin approval. The endpoint returns
`200` with the same user fields as verification and sets a `softerr_session`
cookie. Wrong email or password returns `401` with the same error message;
correct credentials for an unverified or unapproved account return `403`. Invalid input
returns `400`. Nginx returns `429` when the per-IP limit of 10 requests per
minute plus a burst of 10 is exceeded.

The session cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/api/`, and
`Secure` on HTTPS. It is a browser-session cookie; the server expires the
session after two hours of inactivity. Web clients on the same origin send
it automatically. `GET /api/auth/me` returns the verified account and its current role for the
current session or `401` if unauthenticated. `POST /api/auth/logout` ends the
session and returns `200` even when no session exists. Native clients must
store and resend the cookie. Quiz endpoints require the same session cookie.

### List users (admin)

`GET /api/auth/users` requires a verified session with the current `admin`
role. It returns `{ "users": [...] }`, ordered by ID. Each entry has the same
public fields as `/api/auth/me`: `id`, `username`, `email`, `role`, `verified`, `approved`,
and `created`, plus `deleting` to identify a blocked account awaiting cleanup.
Unverified accounts are included; passwords and tokens are not.
The response uses `Cache-Control: no-store`. A missing session returns `401`,
and a `user` or `mod` session returns `403`. Other methods return `405`.

`PATCH /api/auth/users/{userId}/role` accepts `{ "role": "mod" }` and returns
the updated user. The role must be `admin`, `mod`, or `user`. It requires an
admin session, and admins cannot change their own role (`409`). Invalid input
returns `400`, a missing target returns `404`, and a missing or non-admin
session returns `401` or `403`. Role changes take effect on the target user's
next authenticated request. Role changes require an approved, verified target.
The home Users table provides this control.

`POST /api/auth/users/{userId}/approve` approves a verified account and returns
the updated user. An unverified, already approved, or deleting account returns
`409`; a missing account returns `404`. Only an approved admin can call it.
The Users table shows an Approve button for verified accounts awaiting approval.

`DELETE /api/auth/users/{userId}` permanently removes another account, its
verification and reset tokens, and its quiz library. It requires an admin
session; admins cannot delete themselves (`409`). A missing target returns
`404`, and a missing or non-admin session returns `401` or `403`. Success
returns `204` with no body. The Users table asks for confirmation before
deleting. If quiz cleanup fails, the account remains blocked and visible to
admins; retry the same deletion to finish cleanup.

## 6. Password reset

`POST /api/auth/password-reset/request` accepts `{"email":"john@example.com"}`
and returns `202` with the same message for existing, unknown, unverified, and
recently requested accounts. A verified account can queue a reset email once
per ten minutes. Nginx also limits requests to 5 per minute per IP, plus a burst
of 5. The worker creates a 32-byte random token, stores only its SHA-256
digest, and emails a home app link valid for 30 minutes. A retry creates a new
token and invalidates the previous link.

`POST /api/auth/password-reset/confirm` accepts a JSON object with a 64-character
hex `token` and a new `password`. The password must be nonempty and at most
1024 bytes, matching signup. The endpoint returns `200` after changing the
password, consuming all reset tokens, and queuing a change notification in
one transaction. Invalid, expired, and used links return `400`. Nginx limits
requests to 10 per minute per IP, plus a burst of 10. Existing login sessions
become invalid because each session is tied to the password hash from login.
The user must log in again; confirmation does not create a session.

Both request bodies are limited to 4096 bytes. Home and quiz have a forgot-password
form and a reset form opened by the emailed link. The link carries its token
in the URL fragment so the initial page request does not send it to Nginx.

## 7. Email delivery behavior

The `verification_email_queued` response field confirms that the job was committed to PostgreSQL. It does not mean the mail transport accepted or delivered the message. The systemd email worker checks the outbox every minute. It claims each job for 15 minutes, then sends without holding a database transaction open. The delivery schedule and claim are stored separately, so a resend during an active delivery leaves that claim intact; the in-flight delivery can satisfy the resend. Failed deliveries remain queued and are retried after two minutes while the token is valid. If the worker stops during delivery, the claim expires and the job becomes available again. Delivery may happen more than once if the worker stops after SMTP accepts a message but before it deletes the outbox row.

The worker uses SMTP when `SMTP_HOST` is configured and PHP `mail()` otherwise. An SMTP failure does not fall back to `mail()`. Verification or token expiry removes obsolete queued jobs. The client can request another attempt with `POST /api/auth/resend-verification` after the one-minute cooldown.

Successful verification queues one approval notice per active admin in `public.approval_email_outbox`. The same worker sends those notices and retries failures after two minutes. Approval removes notices that have not yet been sent. The worker discards queued notices for recipients who are no longer active admins when it processes them.

Both PHP-FPM and the systemd email worker receive these runtime env vars:

- `DB_HOST` (default `127.0.0.1`)
- `DB_PORT` (default `5432`)
- `DB_NAME` (default `auth`)
- `DB_USER` (default `auth_api`)
- `DB_PASSWORD` (required)
- `APP_BASE_URL` (required HTTPS origin for verification links; loopback HTTP is allowed for local tests)

PHP-FPM also connects to the `quiz` and `media` databases with the same server,
role, and password. The email worker uses only `auth`.

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

The test runner needs database access to `auth`, `quiz`, and `media`. It removes the accounts, quiz data, and media images created by each run when the tests finish, including after a test failure.

GitHub workflow:
- `.github/workflows/test-api-runner.yml` (`Test API On Runner`) runs the OpenAPI contract check and endpoint tests for API, spec, and test-script changes.
- `.github/workflows/test-api-qemu.yml` (`Test API In QEMU`) runs the endpoint tests in a VM when dispatched.

How to add a new endpoint test:
1. Add a new case file in `tests/api/cases/` (for example `40-account-profile.sh`).
2. Define one or more `test_*` functions using helpers from `tests/api/lib.sh`.
3. Register each test with `register_test_case test_function_name`.
4. Workflow/local runner will auto-discover and execute it.
