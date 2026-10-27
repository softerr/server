#!/usr/bin/env bash

reset_psql() {
  local query="$1"
  if [[ -n "${API_TEST_DB_HOST:-}" ]]; then
    PGPASSWORD="${API_TEST_DB_PASSWORD:-}" psql -X -Atq -v ON_ERROR_STOP=1 \
      -h "${API_TEST_DB_HOST}" -p "${API_TEST_DB_PORT:-5432}" \
      -U "${API_TEST_DB_USER:-${API_TEST_DB_SUPERUSER}}" -d "${API_TEST_DB_NAME}" -c "${query}"
  else
    sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -Atq -v ON_ERROR_STOP=1 \
      -d "${API_TEST_DB_NAME}" -c "${query}"
  fi
}

test_password_reset_rejects_invalid_input() {
  api_request POST /api/auth/password-reset/request '{"email":["bad"]}'
  assert_status 400 || return 1
  api_request POST /api/auth/password-reset/confirm '{"token":"bad","password":"new_password"}'
  assert_status 400 || return 1
}

test_password_reset_hides_unknown_account() {
  api_request POST /api/auth/password-reset/request '{"email":"unknown-reset@example.test"}'
  assert_status 202 || return 1
  assert_json_value '.message' 'If this account exists, a password reset email will be sent' || return 1
}

test_password_reset_full_flow_impl() (
  set -e
  create_test_identity
  local body cookie_file response status email_sql count mail_text token_match token digest stored
  body="$(jq -nc --arg username "${TEST_USERNAME}" --arg email "${TEST_EMAIL}" \
    '{username:$username,email:$email,password:"old_password_123"}')"
  api_request POST /api/auth/signup "${body}"
  assert_status 201
  fetch_verify_token_for_email "${TEST_EMAIL}"
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200
  email_sql="$(sql_escape_literal "${TEST_EMAIL}")"
  reset_psql "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP
    WHERE email = '${email_sql}';" >/dev/null

  cookie_file="$(mktemp)"
  trap 'rm -f "${cookie_file}"' EXIT
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"old_password_123"}')"
  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "${body}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  status="${response##*$'\n'}"
  [[ "${status}" == 200 ]] || { fail_test "initial login failed: HTTP ${status}"; return 1; }

  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email}')"
  api_request POST /api/auth/password-reset/request "${body}"
  assert_status 202
  assert_json_value '.message' 'If this account exists, a password reset email will be sent'
  api_request POST /api/auth/password-reset/request "${body}"
  assert_status 202
  count="$(reset_psql "SELECT count(*) FROM public.user_token t
    JOIN public.\"user\" u ON u.id = t.user_id
    WHERE u.email = '${email_sql}' AND t.type = 'password_reset';")"
  [[ "${count}" == 1 ]] || { fail_test "reset cooldown created ${count} tokens"; return 1; }

  sudo -n systemctl start softerr-send-email.service
  token=''
  for attempt in {1..10}; do
    if mail_text="$(curl -fsS --max-time 5 -G --data-urlencode "query=to:${TEST_EMAIL}" \
      "${API_TEST_MAILPIT_URL%/}/view/latest.txt" 2>/dev/null)"; then
      token_match="$(printf '%s' "${mail_text}" | grep -Eo '#reset\?token=[a-f0-9]{64}' || true)"
      if [[ -n "${token_match}" ]]; then
        token="${token_match##*token=}"
        break
      fi
    fi
    sleep 1
  done
  [[ "${token}" =~ ^[a-f0-9]{64}$ ]] || { fail_test 'reset email did not contain a token'; return 1; }
  digest="$(php -r 'echo hash("sha256", hex2bin($argv[1]));' "${token}")"
  stored="$(reset_psql "SELECT t.hash FROM public.user_token t
    JOIN public.\"user\" u ON u.id = t.user_id
    WHERE u.email = '${email_sql}' AND t.type = 'password_reset';")"
  [[ "${stored}" == "${digest}" ]] || { fail_test 'reset token was not stored as a digest'; return 1; }

  reset_psql "UPDATE public.user_token SET expires = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE hash = '${digest}' AND type = 'password_reset';" >/dev/null
  body="$(jq -nc --arg token "${token}" '{token:$token,password:"new_password_456"}')"
  api_request POST /api/auth/password-reset/confirm "${body}"
  assert_status 400
  reset_psql "UPDATE public.user_token SET expires = CURRENT_TIMESTAMP + INTERVAL '30 minutes'
    WHERE hash = '${digest}' AND type = 'password_reset';" >/dev/null

  api_request POST /api/auth/password-reset/confirm "${body}"
  assert_status 200
  assert_json_value '.message' 'Password updated. Please log in.'
  api_request POST /api/auth/password-reset/confirm "${body}"
  assert_status 400

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/me")"
  status="${response##*$'\n'}"
  [[ "${status}" == 401 ]] || { fail_test "old session remained valid: HTTP ${status}"; return 1; }
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"old_password_123"}')"
  api_request POST /api/auth/login "${body}"
  assert_status 401
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"new_password_456"}')"
  api_request POST /api/auth/login "${body}"
  assert_status 200

  sudo -n systemctl start softerr-send-email.service
  count="$(reset_psql "SELECT count(*) FROM public.user_token t
    JOIN public.\"user\" u ON u.id = t.user_id
    WHERE u.email = '${email_sql}' AND t.type = 'password_changed';")"
  [[ "${count}" == 0 ]] || { fail_test 'password change notification job was not delivered'; return 1; }
  mail_text="$(curl -fsS --max-time 5 -G --data-urlencode "query=to:${TEST_EMAIL}" \
    "${API_TEST_MAILPIT_URL%/}/view/latest.txt")"
  [[ "${mail_text}" == *'Your account password was changed.'* ]] \
    || { fail_test 'password change notification email was not captured'; return 1; }
)

test_password_reset_full_flow() {
  if [[ -z "${API_TEST_MAILPIT_URL:-}" ]]; then
    skip_test 'Mailpit is required for the complete password reset flow'
    return 200
  fi
  if ! command -v psql >/dev/null 2>&1; then
    skip_test 'psql is required for the complete password reset flow'
    return 200
  fi
  test_password_reset_full_flow_impl
}

register_test_case test_password_reset_rejects_invalid_input
register_test_case test_password_reset_hides_unknown_account
register_test_case test_password_reset_full_flow
