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
}

register_test_case test_auth_verify_invalid_token
register_test_case test_auth_verify_success
