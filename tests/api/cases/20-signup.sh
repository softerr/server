#!/usr/bin/env bash

test_auth_signup_success() {
  create_test_identity

  local request_body
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg password "test_password_123" --arg email "${TEST_EMAIL}" '{username:$username,password:$password,email:$email}')"

  api_request "POST" "/api/auth/signup" "${request_body}"

  assert_status "201" || return 1
  assert_json_value '.username' "${TEST_USERNAME}" || return 1
  assert_json_value '.email' "${TEST_EMAIL}" || return 1
  assert_json_value '.verified' "false" || return 1
  assert_json_expression '.id | type == "number"' || return 1
  assert_json_expression '.created != null and .created != ""' || return 1
  assert_json_expression '.verification_email_sent | type == "boolean"' || return 1
  if [[ "${API_TEST_REQUIRE_EMAIL:-0}" == "1" ]]; then
    assert_json_value '.verification_email_sent' 'true' || return 1
  fi
}

test_auth_signup_duplicate_conflict() {
  if [[ -z "${TEST_EMAIL}" || -z "${TEST_USERNAME}" ]]; then
    skip_test "signup success unavailable; skipping duplicate signup test"
    return 200
  fi

  local request_body
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg password "test_password_123" --arg email "${TEST_EMAIL}" '{username:$username,password:$password,email:$email}')"

  api_request "POST" "/api/auth/signup" "${request_body}"
  assert_status "409" || return 1
  assert_json_value '.error' 'username or email already exists' || return 1
}

register_test_case test_auth_signup_success
register_test_case test_auth_signup_duplicate_conflict
