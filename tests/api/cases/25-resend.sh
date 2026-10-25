#!/usr/bin/env bash

test_auth_resend_invalid_email() {
  api_request "POST" "/api/auth/resend-verification" '{"email":"invalid"}'
  assert_status "400" || return 1
  assert_json_value '.error' 'A valid email is required' || return 1
}

test_auth_resend_unknown_email() {
  api_request "POST" "/api/auth/resend-verification" '{"email":"nonexistent@example.test"}'
  assert_status "202" || return 1
}

test_auth_resend_recent_signup() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test "signup unavailable; skipping resend check"
    return 200
  fi

  local request_body
  request_body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email}')"
  api_request "POST" "/api/auth/resend-verification" "${request_body}"
  assert_status "202" || return 1
}

register_test_case test_auth_resend_invalid_email
register_test_case test_auth_resend_unknown_email
register_test_case test_auth_resend_recent_signup
