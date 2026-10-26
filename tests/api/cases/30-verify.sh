#!/usr/bin/env bash

test_auth_verify_invalid_token() {
  api_request "GET" "/api/auth/verify?token=invalid"
  assert_status "400" || return 1
  assert_json_value '.error' 'Invalid verification token' || return 1
}

test_auth_verify_success() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test "signup success unavailable; skipping verify success test"
    return 200
  fi

  fetch_verify_token_for_email "${TEST_EMAIL}"
  local fetch_rc=$?
  if [[ ${fetch_rc} -eq 200 ]]; then
    return 200
  fi
  if [[ ${fetch_rc} -ne 0 ]]; then
    return 1
  fi

  api_request "GET" "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status "200" || return 1
  assert_json_value '.username' "${TEST_USERNAME}" || return 1
  assert_json_value '.email' "${TEST_EMAIL}" || return 1
  assert_json_value '.verified' "true" || return 1

  api_request "GET" "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status "400" || return 1
  assert_json_value '.error' 'Verification token is invalid or expired' || return 1
}

test_auth_verify_browser_page() {
  create_test_identity
  local request_body response status body headers
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg email "${TEST_EMAIL}" \
    '{username:$username,password:"test_password_123",email:$email}')"
  api_request POST /api/auth/signup "${request_body}"
  assert_status 201 || return 1
  fetch_verify_token_for_email "${TEST_EMAIL}" || return $?

  headers="$(mktemp)"
  response="$(curl -sS -D "${headers}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/verify?token=${TEST_VERIFY_TOKEN}&view=html")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [[ "${status}" != 200 ]] || [[ "${body}" != *'<h1>Email verified</h1>'* ]] \
    || ! grep -qi '^Content-Type: text/html' "${headers}"; then
    rm -f "${headers}"
    fail_test "browser verification did not render success page (HTTP ${status})"
    return 1
  fi

  response="$(curl -sS -D "${headers}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/verify?token=${TEST_VERIFY_TOKEN}&view=html")"
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  rm -f "${headers}"
  if [[ "${status}" != 400 ]] || [[ "${body}" != *'<h1>Verification failed</h1>'* ]]; then
    fail_test "browser verification did not render failure page (HTTP ${status})"
    return 1
  fi
}

register_test_case test_auth_verify_invalid_token
register_test_case test_auth_verify_success
register_test_case test_auth_verify_browser_page
