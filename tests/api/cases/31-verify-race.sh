#!/usr/bin/env bash

verify_race_psql() {
  if [[ -n "${API_TEST_DB_HOST:-}" ]]; then
    PGPASSWORD="${API_TEST_DB_PASSWORD:-}" psql -X -Atq -v ON_ERROR_STOP=1 \
      -h "${API_TEST_DB_HOST}" -p "${API_TEST_DB_PORT:-5432}" \
      -U "${API_TEST_DB_USER:-${API_TEST_DB_SUPERUSER}}" -d "${API_TEST_DB_NAME}" "$@"
  else
    sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -Atq -v ON_ERROR_STOP=1 \
      -d "${API_TEST_DB_NAME}" "$@"
  fi
}

test_auth_verify_token_removed_while_waiting_impl() (
  set -e
  create_test_identity
  local request_body account_id token work_dir holder request_pid status verified waiting attempt
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg password 'test_password_123' \
    --arg email "${TEST_EMAIL}" '{username:$username,password:$password,email:$email}')"
  api_request POST /api/auth/signup "${request_body}"
  assert_status 201 || return 1
  account_id="$(jq -r '.id' <<<"${TEST_LAST_RESPONSE_BODY}")"
  fetch_verify_token_for_email "${TEST_EMAIL}" || return 1
  token="${TEST_VERIFY_TOKEN}"

  work_dir="$(mktemp -d)"
  holder=''
  request_pid=''
  cleanup() {
    exec 9>&- 2>/dev/null || true
    if [[ -n "${holder}" ]]; then kill "${holder}" 2>/dev/null || true; wait "${holder}" 2>/dev/null || true; fi
    if [[ -n "${request_pid}" ]]; then kill "${request_pid}" 2>/dev/null || true; wait "${request_pid}" 2>/dev/null || true; fi
    rm -rf -- "${work_dir}"
  }
  trap cleanup EXIT

  mkfifo "${work_dir}/commands"
  verify_race_psql < "${work_dir}/commands" > "${work_dir}/lock.log" 2>&1 &
  holder=$!
  exec 9> "${work_dir}/commands"
  printf 'BEGIN;\nSELECT id FROM public."user" WHERE id = %s FOR UPDATE;\n\\echo LOCKED\n' \
    "${account_id}" >&9
  for attempt in {1..50}; do
    if grep -qx LOCKED "${work_dir}/lock.log"; then break; fi
    if ! kill -0 "${holder}" 2>/dev/null; then
      fail_test 'could not hold the account lock for verification race test'
      return 1
    fi
    sleep 0.1
  done
  if ! grep -qx LOCKED "${work_dir}/lock.log"; then
    fail_test 'timed out waiting for the account lock'
    return 1
  fi

  curl -sS --max-time 30 --output "${work_dir}/response" --write-out '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/verify?token=${token}" > "${work_dir}/status" &
  request_pid=$!
  waiting=0
  for attempt in {1..100}; do
    waiting="$(verify_race_psql -c "SELECT count(*) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%SELECT id FROM public.\"user\" WHERE id = \$1%FOR UPDATE%';")"
    if [[ "${waiting}" -gt 0 ]]; then break; fi
    if ! kill -0 "${request_pid}" 2>/dev/null; then
      fail_test 'verification finished before waiting for the account lock'
      return 1
    fi
    sleep 0.1
  done
  if [[ "${waiting}" -eq 0 ]]; then
    fail_test 'verification did not wait for the account lock'
    return 1
  fi

  verify_race_psql -c "DELETE FROM public.user_token WHERE hash = '${token}';" >/dev/null
  printf 'COMMIT;\n' >&9
  exec 9>&-
  wait "${holder}"
  holder=''
  wait "${request_pid}"
  request_pid=''

  status="$(cat "${work_dir}/status")"
  if [[ "${status}" != 400 ]]; then
    fail_test "expected invalidated verification token to return 400, got ${status}; body=$(cat "${work_dir}/response")"
    return 1
  fi
  verified="$(verify_race_psql -c "SELECT verified FROM public.\"user\" WHERE id = ${account_id};")"
  if [[ "${verified}" != f ]]; then
    fail_test 'account was verified after its token was removed'
    return 1
  fi
)

test_auth_verify_token_removed_while_waiting() {
  if [[ "${API_TEST_REQUIRE_DB:-1}" != 1 ]]; then
    skip_test 'database checks are optional; skipping verification race test'
    return 200
  fi
  if ! command -v psql >/dev/null 2>&1; then
    fail_test 'psql is required for verification race test'
    return 1
  fi
  test_auth_verify_token_removed_while_waiting_impl
}

register_test_case test_auth_verify_token_removed_while_waiting
