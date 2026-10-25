#!/usr/bin/env bash

test_auth_resend_after_delivery_failure_impl() (
  local mailpit_url="${API_TEST_MAILPIT_URL%/}"
  local email query request_body mailbox aged_token escaped_email sql failed_attempts

  create_test_identity
  email="${TEST_EMAIL}"
  query="to:${email}"
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg password 'test_password_123' --arg email "${email}" '{username:$username,password:$password,email:$email}')"

  if ! sudo -n systemctl stop softerr-send-email.timer; then
    fail_test 'could not pause email timer for deterministic delivery check'
    return 1
  fi
  trap 'curl -fsS --max-time 10 -X PUT -H "Content-Type: application/json" --data "{}" "${mailpit_url}/api/v1/chaos" >/dev/null || true; sudo -n systemctl start softerr-send-email.timer || true' EXIT
  if ! sudo -n systemctl stop softerr-send-email.service; then
    fail_test 'could not stop an active email worker before delivery check'
    return 1
  fi

  # Mailpit rejects the worker's first SMTP attempt without changing configuration.
  if ! curl -fsS --max-time 10 -X PUT -H 'Content-Type: application/json' \
      --data '{"Sender":{"ErrorCode":451,"Probability":100}}' \
      "${mailpit_url}/api/v1/chaos" | jq -e '.Sender.Probability == 100' >/dev/null; then
    fail_test 'could not enable Mailpit SMTP rejection'
    return 1
  fi
  api_request 'POST' '/api/auth/signup' "${request_body}"
  assert_status '201' || return 1
  assert_json_value '.verification_email_queued' 'true' || return 1
  sudo -n systemctl start softerr-send-email.service >/dev/null 2>&1 || true

  escaped_email="$(sql_escape_literal "${email}")"
  sql="SELECT COALESCE(MAX(o.attempts), 0)
       FROM public.verification_email_outbox o
       JOIN public.user_token t ON t.id = o.token_id
       JOIN public.\"user\" u ON u.id = t.user_id
       WHERE u.email = '${escaped_email}';"
  if [[ -n "${API_TEST_DB_HOST:-}" ]]; then
    failed_attempts="$(PGPASSWORD="${API_TEST_DB_PASSWORD:-}" psql -h "${API_TEST_DB_HOST}" \
      -p "${API_TEST_DB_PORT:-5432}" -U "${API_TEST_DB_USER:-${API_TEST_DB_SUPERUSER}}" \
      -d "${API_TEST_DB_NAME}" -Atqc "${sql}")" || return 1
  else
    failed_attempts="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql \
      -d "${API_TEST_DB_NAME}" -Atqc "${sql}")" || return 1
  fi
  if [[ "${failed_attempts}" != 1 ]]; then
    fail_test "expected one failed queued email attempt, got ${failed_attempts}"
    return 1
  fi

  if ! mailbox="$(curl -fsS --max-time 10 -G --data-urlencode "query=${query}" "${mailpit_url}/api/v1/search")"; then
    fail_test 'could not inspect Mailpit after rejected signup email'
    return 1
  fi
  if ! jq -e '.messages_count == 0' >/dev/null <<<"${mailbox}"; then
    fail_test 'Mailpit captured an email despite SMTP rejection'
    return 1
  fi

  if ! curl -fsS --max-time 10 -X PUT -H 'Content-Type: application/json' \
      --data '{}' "${mailpit_url}/api/v1/chaos" | jq -e '(.Sender.Probability // 0) == 0' >/dev/null; then
    fail_test 'could not clear Mailpit SMTP rejection'
    return 1
  fi

  # Move only this test account past the resend cooldown.
  sql="UPDATE public.user_token t
       SET email_attempted_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes'
       FROM public.\"user\" u
       WHERE t.user_id = u.id AND u.email = '${escaped_email}' AND t.type = 'verify'
       RETURNING t.id;"
  if [[ -n "${API_TEST_DB_HOST:-}" ]]; then
    aged_token="$(PGPASSWORD="${API_TEST_DB_PASSWORD:-}" psql -h "${API_TEST_DB_HOST}" \
      -p "${API_TEST_DB_PORT:-5432}" -U "${API_TEST_DB_USER:-${API_TEST_DB_SUPERUSER}}" \
      -d "${API_TEST_DB_NAME}" -Atqc "${sql}")" || {
        fail_test 'could not clear resend cooldown in PostgreSQL'
        return 1
      }
  else
    aged_token="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql \
      -d "${API_TEST_DB_NAME}" -Atqc "${sql}")" || {
        fail_test 'could not clear resend cooldown in PostgreSQL'
        return 1
      }
  fi
  if [[ -z "${aged_token}" ]]; then
    fail_test 'signup did not leave a verification token for resend'
    return 1
  fi

  # The resend requeues the failed job for immediate delivery.

  request_body="$(jq -nc --arg email "${email}" '{email:$email}')"
  api_request 'POST' '/api/auth/resend-verification' "${request_body}"
  assert_status '202' || return 1
  if ! sudo -n systemctl start softerr-send-email.service; then
    fail_test 'email worker could not deliver the queued resend'
    return 1
  fi

  local attempt
  for attempt in {1..10}; do
    if mailbox="$(curl -fsS --max-time 10 -G --data-urlencode "query=${query}" "${mailpit_url}/api/v1/search")" \
      && jq -e --arg email "${email}" 'any(.messages[]?; any(.To[]?; .Address == $email))' >/dev/null <<<"${mailbox}"; then
      return 0
    fi
    sleep 1
  done

  fail_test "resend email for ${email} did not reach Mailpit"
  return 1
)

test_auth_resend_after_delivery_failure() {
  if [[ -z "${API_TEST_MAILPIT_URL:-}" ]]; then
    skip_test 'Mailpit API URL is not configured; skipping resend delivery test'
    return 200
  fi
  if ! command -v psql >/dev/null 2>&1; then
    fail_test 'psql is required for resend delivery test'
    return 1
  fi
  test_auth_resend_after_delivery_failure_impl
}

register_test_case test_auth_resend_after_delivery_failure
