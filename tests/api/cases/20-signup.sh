#!/usr/bin/env bash

test_auth_signup_success() {
  create_test_identity

  local request_body
  request_body="$(jq -nc --arg username "${TEST_USERNAME}" --arg password "test_password_123" --arg email "${TEST_EMAIL}" '{username:$username,password:$password,email:$email,role:"admin"}')"

  api_request "POST" "/api/auth/signup" "${request_body}"

  assert_status "201" || return 1
  assert_json_value '.username' "${TEST_USERNAME}" || return 1
  assert_json_value '.email' "${TEST_EMAIL}" || return 1
  assert_json_value '.role' 'user' || return 1
  assert_json_value '.verified' "false" || return 1
  assert_json_expression '.id | type == "number"' || return 1
  assert_json_expression '.created != null and .created != ""' || return 1
  assert_json_value '.verification_email_queued' 'true' || return 1
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

test_auth_signup_rejects_oversized_password() {
  local request_body
  request_body="$(jq -nc --arg password "$(printf '%01025d' 0)" '{username:"length_check",password:$password,email:"length_check@example.test"}')"

  api_request "POST" "/api/auth/signup" "${request_body}"
  assert_status "400" || return 1
  assert_json_value '.error' 'password must be at most 1024 bytes' || return 1
}

test_auth_signup_rejects_non_string_fields() {
  api_request "POST" "/api/auth/signup" '{"username":["name"],"password":"secret","email":"name@example.test"}'
  assert_status "400" || return 1
  assert_json_value '.error' 'username, password and email are required' || return 1
}

test_auth_signup_rejects_oversized_body() {
  local request_body
  request_body="$(jq -nc --arg padding "$(printf '%05000d' 0)" '{username:"length_check",password:"secret",email:"length_check@example.test",padding:$padding}')"

  api_request "POST" "/api/auth/signup" "${request_body}"
  assert_status "413" || return 1
}

register_test_case test_auth_signup_success
register_test_case test_auth_signup_duplicate_conflict
register_test_case test_auth_signup_rejects_oversized_password
register_test_case test_auth_signup_rejects_non_string_fields
register_test_case test_auth_signup_rejects_oversized_body
