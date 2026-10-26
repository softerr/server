#!/usr/bin/env bash

test_auth_login_rejects_invalid_body() {
  api_request POST /api/auth/login '{"email":["bad"],"password":"secret"}'
  assert_status 400 || return 1
  assert_json_value '.error' 'email and password are required' || return 1
}

test_auth_login_rejects_invalid_credentials() {
  local body
  body="$(jq -nc --arg email "${TEST_EMAIL:-unknown@example.test}" '{email:$email,password:"wrong_password"}')"
  api_request POST /api/auth/login "${body}"
  assert_status 401 || return 1
  assert_json_value '.error' 'Invalid email or password' || return 1

  api_request POST /api/auth/login '{"email":"unknown@example.test","password":"wrong_password"}'
  assert_status 401 || return 1
  assert_json_value '.error' 'Invalid email or password' || return 1
}

test_auth_login_requires_verification() {
  create_test_identity
  local body
  body="$(jq -nc --arg username "${TEST_USERNAME}" --arg email "${TEST_EMAIL}" '{username:$username,email:$email,password:"test_password_123"}')"
  api_request POST /api/auth/signup "${body}"
  assert_status 201 || return 1

  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')"
  api_request POST /api/auth/login "${body}"
  assert_status 403 || return 1
  assert_json_value '.error' 'Verify your email before logging in' || return 1
}

test_auth_login_session_lifecycle() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test "signup success unavailable; skipping login session test"
    return 200
  fi

  fetch_verify_token_for_email "${TEST_EMAIL}" || return $?
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200 || return 1

  local cookie_file headers body response status response_body
  cookie_file="$(mktemp)"
  headers="$(mktemp)"
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')"
  response="$(curl -sS -c "${cookie_file}" -D "${headers}" -H 'Content-Type: application/json' \
    --data "${body}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  status="${response##*$'\n'}"
  response_body="${response%$'\n'*}"
  if [[ "${status}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" '.email == $email and .verified == true' <<<"${response_body}" >/dev/null; then
    rm -f "${cookie_file}" "${headers}"
    fail_test "login failed: HTTP ${status}; body=${response_body}"
    return 1
  fi
  if ! grep -qi 'Set-Cookie: softerr_session=.*HttpOnly.*SameSite=Strict' "${headers}"; then
    rm -f "${cookie_file}" "${headers}"
    fail_test 'login cookie lacks HttpOnly or SameSite=Strict'
    return 1
  fi
  rm -f "${headers}"

  api_request GET /api/auth/me
  assert_status 401 || { rm -f "${cookie_file}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/me")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" '.email == $email' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test 'session did not authenticate /api/auth/me'
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/logout")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    rm -f "${cookie_file}"
    fail_test 'logout did not return HTTP 200'
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/me")"
  rm -f "${cookie_file}"
  if [[ "${response##*$'\n'}" != 401 ]]; then
    fail_test 'old session remains authenticated after logout'
    return 1
  fi
}

register_test_case test_auth_login_rejects_invalid_body
register_test_case test_auth_login_rejects_invalid_credentials
register_test_case test_auth_login_requires_verification
register_test_case test_auth_login_session_lifecycle
