#!/usr/bin/env bash

test_admin_updates_user_identity() (
  set -e
  local admin_name admin_email admin_id target_name target_email target_id
  local pending_name pending_email pending_id old_token new_token cookie response
  local updated_name updated_email
  create_test_identity
  admin_name="${TEST_USERNAME}"
  admin_email="${TEST_EMAIL}"
  create_test_identity
  target_name="${TEST_USERNAME}"
  target_email="${TEST_EMAIL}"
  local hash
  hash="$(php -r 'echo password_hash("test_password_123", PASSWORD_DEFAULT);')"
  admin_id="$(test_psql auth "INSERT INTO public.\"user\"
    (username, email, password, role, verified, approved_at)
    VALUES ('${admin_name}', '${admin_email}', '${hash}', 'admin', TRUE, CURRENT_TIMESTAMP)
    RETURNING id;")"
  target_id="$(test_psql auth "INSERT INTO public.\"user\"
    (username, email, password, verified, approved_at)
    VALUES ('${target_name}', '${target_email}', '${hash}', TRUE, CURRENT_TIMESTAMP)
    RETURNING id;")"
  cookie="$(mktemp)"
  restore_identity_fixture() {
    test_psql auth "UPDATE public.\"user\" SET email = username || '@example.test'
      WHERE id IN (${admin_id}, ${target_id}, ${pending_id:-0});" >/dev/null
    rm -f -- "${cookie}"
  }
  trap restore_identity_fixture EXIT
  response="$(curl -sS -c "${cookie}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${admin_email}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test 'Admin login failed'; return 1; }

  api_request PATCH "/api/auth/users/${target_id}" '{"username":"Bad","email":"invalid"}'
  assert_status 401
  updated_name="api_test_${API_TEST_RUN_ID}_renamed"
  updated_email="${updated_name}@example.test"
  response="$(curl -sS -b "${cookie}" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "${updated_name}" --arg e "${updated_email^^}" \
      '{username:$u,email:$e}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg u "${updated_name}" --arg e "${updated_email}" \
    '.username == $u and .email == $e and .verified == true' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "Could not update identity: ${response}"
    return 1
  fi
  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "${target_email}" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test 'Old email still logged in'; return 1; }
  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "${updated_email}" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test 'New email could not log in'; return 1; }
  response="$(curl -sS -b "${cookie}" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "${admin_name}" --arg e "${updated_email}" '{username:$u,email:$e}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test 'Duplicate username was accepted'; return 1; }
  response="$(curl -sS -b "${cookie}" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "${updated_name}" --arg e "${admin_email}" '{username:$u,email:$e}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test 'Duplicate email was accepted'; return 1; }

  create_test_identity
  pending_name="${TEST_USERNAME}"
  pending_email="${TEST_EMAIL}"
  api_request POST /api/auth/signup "$(jq -nc --arg u "${pending_name}" --arg e "${pending_email}" \
    '{username:$u,email:$e,password:"test_password_123"}')"
  assert_status 201
  pending_id="$(json_field_or_empty '.id')"
  fetch_verify_token_for_email "${pending_email}"
  old_token="${TEST_VERIFY_TOKEN}"
  local replacement_email="fixed_${RANDOM}@example.test"
  response="$(curl -sS -b "${cookie}" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg u "${pending_name}" --arg e "${replacement_email}" \
      '{username:$u,email:$e}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/users/${pending_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "Could not correct pending email: ${response}"; return 1; }
  api_request GET "/api/auth/verify?token=${old_token}"
  assert_status 400
  fetch_verify_token_for_email "${replacement_email}"
  new_token="${TEST_VERIFY_TOKEN}"
  [[ "${new_token}" != "${old_token}" ]] || { fail_test 'Verification token was not replaced'; return 1; }
  api_request GET "/api/auth/verify?token=${new_token}"
  assert_status 200
  [[ "$(test_psql auth "SELECT email FROM public.\"user\" WHERE id = ${pending_id};")" == "${replacement_email}" ]] \
    || { fail_test 'Replacement email was not saved'; return 1; }
  [[ "${admin_id}" =~ ^[1-9][0-9]*$ ]] || { fail_test 'Invalid admin fixture'; return 1; }
)

register_test_case test_admin_updates_user_identity
