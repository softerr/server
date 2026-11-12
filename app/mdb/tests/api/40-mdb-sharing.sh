#!/usr/bin/env bash

test_mdb_database_sharing() (
  set -e
  sudo -n systemctl restart nginx
  local owner_cookie guest_cookie owner_name owner_email guest_name guest_email
  local owner_id guest_id database_id row_id response
  owner_cookie="$(mktemp)"
  guest_cookie="$(mktemp)"
  trap 'rm -f -- "${owner_cookie}" "${guest_cookie}"' EXIT

  sharing_request() {
    local cookie="$1" method="$2" path="$3" body="${4:-}" result
    if [[ -n "${body}" ]]; then
      result="$(curl -sS -b "${cookie}" -X "${method}" -H 'Content-Type: application/json' \
        --data "${body}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}${path}")"
    else
      result="$(curl -sS -b "${cookie}" -X "${method}" \
        -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}${path}")"
    fi
    # shellcheck disable=SC2034 # Asserted by the sourced API test harness.
    TEST_LAST_RESPONSE_STATUS="${result##*$'\n'}"
    TEST_LAST_RESPONSE_BODY="${result%$'\n'*}"
  }

  create_test_identity
  owner_name="${TEST_USERNAME}"
  owner_email="${TEST_EMAIL}"
  api_request POST /api/auth/signup "$(jq -nc --arg u "${owner_name}" --arg e "${owner_email}" \
    '{username:$u,email:$e,password:"test_password_123"}')"
  assert_status 201
  owner_id="$(json_field_or_empty '.id')"
  fetch_verify_token_for_email "${owner_email}"
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200
  test_psql auth "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP WHERE id = ${owner_id};" >/dev/null

  create_test_identity
  guest_name="${TEST_USERNAME}"
  guest_email="${TEST_EMAIL}"
  api_request POST /api/auth/signup "$(jq -nc --arg u "${guest_name}" --arg e "${guest_email}" \
    '{username:$u,email:$e,password:"test_password_123"}')"
  assert_status 201
  guest_id="$(json_field_or_empty '.id')"
  fetch_verify_token_for_email "${guest_email}"
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200
  test_psql auth "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP WHERE id = ${guest_id};" >/dev/null

  response="$(curl -sS -c "${owner_cookie}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "${owner_email}" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "Owner login failed: ${response}"; return 1; }
  response="$(curl -sS -c "${guest_cookie}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "${guest_email}" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "Guest login failed: ${response}"; return 1; }

  sharing_request "${owner_cookie}" POST /api/mdb/databases '{"name":"Shared project"}'
  assert_status 201
  database_id="$(json_field_or_empty '.id')"
  sharing_request "${guest_cookie}" GET "/api/mdb/databases/${database_id}"
  assert_status 404
  sharing_request "${owner_cookie}" POST "/api/mdb/databases/${database_id}/shares" \
    "$(jq -nc --arg u "${guest_name}" '{username:$u,permission:"view"}')"
  assert_status 201
  assert_json_value '.permission' view
  sharing_request "${owner_cookie}" GET "/api/mdb/databases/${database_id}/shares"
  assert_status 200
  jq -e --argjson id "${guest_id}" \
    '(.shares | length) == 1 and .shares[0].user_id == $id and .shares[0].permission == "view"' \
    <<<"${TEST_LAST_RESPONSE_BODY}" >/dev/null || { fail_test 'Share list was incorrect'; return 1; }
  sharing_request "${guest_cookie}" GET /api/mdb/databases
  assert_status 200
  jq -e --argjson id "${database_id}" \
    '.databases | any(.id == $id and .is_owner == false and .permission == "view")' \
    <<<"${TEST_LAST_RESPONSE_BODY}" >/dev/null || { fail_test 'Shared database was not listed'; return 1; }
  sharing_request "${guest_cookie}" GET "/api/mdb/databases/${database_id}"
  assert_status 200
  assert_json_value '.database.permission' view
  sharing_request "${guest_cookie}" POST "/api/mdb/databases/${database_id}/rows" '{}'
  assert_status 404
  sharing_request "${guest_cookie}" GET "/api/mdb/databases/${database_id}/shares"
  assert_status 404
  sharing_request "${guest_cookie}" PATCH "/api/mdb/databases/${database_id}/shares/${guest_id}" \
    '{"permission":"edit"}'
  assert_status 404
  sharing_request "${owner_cookie}" POST "/api/mdb/databases/${database_id}/shares" \
    "$(jq -nc --arg u "${guest_name}" '{username:$u,permission:"view"}')"
  assert_status 409
  sharing_request "${owner_cookie}" POST "/api/mdb/databases/${database_id}/shares" \
    "$(jq -nc --arg u "${owner_name}" '{username:$u,permission:"view"}')"
  assert_status 400
  sharing_request "${owner_cookie}" PATCH "/api/mdb/databases/${database_id}/shares/${guest_id}" \
    '{"permission":"edit"}'
  assert_status 200
  sharing_request "${guest_cookie}" POST "/api/mdb/databases/${database_id}/rows" '{}'
  assert_status 201
  row_id="$(json_field_or_empty '.id')"
  [[ "${row_id}" =~ ^[1-9][0-9]*$ ]] || { fail_test 'Editor did not create a row'; return 1; }
  sharing_request "${owner_cookie}" PATCH "/api/mdb/databases/${database_id}/shares/${guest_id}" \
    '{"permission":"view"}'
  assert_status 200
  sharing_request "${guest_cookie}" POST "/api/mdb/databases/${database_id}/rows" '{}'
  assert_status 404
  sharing_request "${owner_cookie}" DELETE "/api/mdb/databases/${database_id}/shares/${guest_id}"
  assert_status 204
  sharing_request "${guest_cookie}" GET "/api/mdb/databases/${database_id}"
  assert_status 404
)

register_test_case test_mdb_database_sharing
