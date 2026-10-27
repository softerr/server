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

test_quiz_library_requires_login() {
  api_request GET /api/quizzes
  assert_status 404 || return 1
  api_request GET /api/quiz/quizzes
  assert_status 401 || return 1
  api_request POST /api/quiz/quizzes '{"name":"Geography"}'
  assert_status 401 || return 1
  api_request PATCH /api/quiz/quizzes/1 '{"name":"Updated"}'
  assert_status 401 || return 1
  api_request DELETE /api/quiz/quizzes/1
  assert_status 401 || return 1
}

test_auth_users_requires_admin() {
  api_request GET /api/auth/users
  assert_status 401 || return 1
  api_request POST /api/auth/users '{}'
  assert_status 405 || return 1
  api_request PATCH /api/auth/users/1/role '{"role":"mod"}'
  assert_status 401 || return 1
  api_request GET /api/auth/users/1/role
  assert_status 405 || return 1
  api_request DELETE /api/auth/users/1
  assert_status 401 || return 1
  api_request GET /api/auth/users/1
  assert_status 405 || return 1
}

test_auth_login_session_lifecycle() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test "signup success unavailable; skipping login session test"
    return 200
  fi

  fetch_verify_token_for_email "${TEST_EMAIL}" || return $?
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200 || return 1

  local cookie_file headers body response status response_body current_id
  cookie_file="$(mktemp)"
  headers="$(mktemp)"
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')"
  response="$(curl -sS -c "${cookie_file}" -D "${headers}" -H 'Content-Type: application/json' \
    --data "${body}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  status="${response##*$'\n'}"
  response_body="${response%$'\n'*}"
  current_id="$(jq -r '.id // empty' <<<"${response_body}")"
  if [[ "${status}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" '.email == $email and .role == "user" and .verified == true' <<<"${response_body}" >/dev/null; then
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
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" '.email == $email and .role == "user"' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test 'session did not authenticate /api/auth/me'
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    rm -f "${cookie_file}"
    fail_test "user role could list users: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"role":"mod"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${current_id}/role")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    rm -f "${cookie_file}"
    fail_test "user role could change account roles: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/users/${current_id}")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    rm -f "${cookie_file}"
    fail_test "user role could delete an account: ${response}"
    return 1
  fi

  if [[ -z "${API_TEST_DB_HOST:-}" ]] && sudo -n -u "${API_TEST_DB_SUPERUSER}" true 2>/dev/null; then
    local role escaped_email permission_result target_name target_email target_id desired_role target_cookie quiz_id
    escaped_email="$(sql_escape_literal "${TEST_EMAIL}")"
    if permission_result="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -v ON_ERROR_STOP=1 \
      -d "${API_TEST_DB_NAME}" -Atqc "BEGIN; SET ROLE auth_api; UPDATE public.\"user\" SET email = email WHERE email = '${escaped_email}'; ROLLBACK;" 2>&1)" \
      || [[ "${permission_result}" != *'permission denied'* ]]; then
      rm -f "${cookie_file}"
      fail_test "API database role could update account email: ${permission_result}"
      return 1
    fi
    target_name="api_role_target_${API_TEST_RUN_ID}_$(date +%s)_${RANDOM}"
    target_email="${target_name}@example.test"
    api_request POST /api/auth/signup "$(jq -nc --arg username "${target_name}" --arg email "${target_email}" \
      '{username:$username,email:$email,password:"test_password_123"}')"
    assert_status 201 || { rm -f "${cookie_file}"; return 1; }
    target_id="$(json_field_or_empty '.id')"
    if [[ -z "${target_id}" ]]; then
      rm -f "${cookie_file}"
      fail_test 'role target signup returned no user ID'
      return 1
    fi
    for role in admin mod user; do
      if ! sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -v ON_ERROR_STOP=1 \
        -d "${API_TEST_DB_NAME}" -c "UPDATE public.\"user\" SET role = '${role}' WHERE email = '${escaped_email}'" >/dev/null; then
        rm -f "${cookie_file}"
        fail_test "could not assign ${role} role to test account"
        return 1
      fi
      response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/me")"
      if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg role "${role}" '.role == $role' <<<"${response%$'\n'*}" >/dev/null; then
        rm -f "${cookie_file}"
        fail_test "session did not reflect ${role} role: ${response}"
        return 1
      fi
      response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users")"
      if [[ "${role}" == admin ]]; then
        if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" \
          '.users | type == "array" and any(.email == $email and .role == "admin") and all(has("password") | not)' \
          <<<"${response%$'\n'*}" >/dev/null; then
          rm -f "${cookie_file}"
          fail_test "admin could not list users safely: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
          --data '{"role":"owner"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}/role")"
        if [[ "${response##*$'\n'}" != 400 ]]; then
          rm -f "${cookie_file}"
          fail_test "invalid role was accepted: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
          --data '{"role":"mod"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${current_id}/role")"
        if [[ "${response##*$'\n'}" != 409 ]]; then
          rm -f "${cookie_file}"
          fail_test "admin could change own role: ${response}"
          return 1
        fi
        for desired_role in mod admin user; do
          response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
            --data "{\"role\":\"${desired_role}\"}" -w $'\n%{http_code}' \
            "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}/role")"
          if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg role "${desired_role}" '.role == $role' \
            <<<"${response%$'\n'*}" >/dev/null; then
            rm -f "${cookie_file}"
            fail_test "admin could not assign ${desired_role} role: ${response}"
            return 1
          fi
        done
        response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users")"
        if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${target_email}" \
          '.users | any(.email == $email and .role == "user")' <<<"${response%$'\n'*}" >/dev/null; then
          rm -f "${cookie_file}"
          fail_test "updated role missing from user list: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users/${current_id}")"
        if [[ "${response##*$'\n'}" != 409 ]]; then
          rm -f "${cookie_file}"
          fail_test "admin could delete own account: ${response}"
          return 1
        fi
        fetch_verify_token_for_email "${target_email}" || { rm -f "${cookie_file}"; return 1; }
        api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
        assert_status 200 || { rm -f "${cookie_file}"; return 1; }
        target_cookie="$(mktemp)"
        response="$(curl -sS -c "${target_cookie}" -H 'Content-Type: application/json' \
          --data "$(jq -nc --arg email "${target_email}" '{email:$email,password:"test_password_123"}')" \
          -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
        if [[ "${response##*$'\n'}" != 200 ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "role target could not log in: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${target_cookie}" -H 'Content-Type: application/json' \
          --data '{"name":"Deletion check"}' -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
        quiz_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
        if [[ "${response##*$'\n'}" != 201 || -z "${quiz_id}" ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "role target could not create quiz: ${response}"
          return 1
        fi
        if ! sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -v ON_ERROR_STOP=1 -d quiz \
          -c 'REVOKE DELETE ON TABLE public."user" FROM auth_api' >/dev/null; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test 'could not simulate quiz cleanup failure'
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}")"
        if ! sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -v ON_ERROR_STOP=1 -d quiz \
          -c 'GRANT DELETE ON TABLE public."user" TO auth_api' >/dev/null; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test 'could not restore quiz cleanup permission'
          return 1
        fi
        if [[ "${response##*$'\n'}" != 500 ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "quiz cleanup failure did not keep deletion pending: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${target_cookie}" -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/me")"
        if [[ "${response##*$'\n'}" != 401 ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "pending deletion did not block target session: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users")"
        if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${target_email}" \
          '.users | any(.email == $email and .deleting == true)' <<<"${response%$'\n'*}" >/dev/null; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "pending deletion was not visible to admin: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}")"
        if [[ "${response##*$'\n'}" != 204 ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "admin could not finish deleting user: ${response}"
          return 1
        fi
        response="$(curl -sS -b "${target_cookie}" -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/me")"
        rm -f "${target_cookie}"
        if [[ "${response##*$'\n'}" != 401 ]]; then
          rm -f "${cookie_file}"
          fail_test "deleted user's session remains active: ${response}"
          return 1
        fi
        local auth_count quiz_count quiz_user_count
        auth_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d "${API_TEST_DB_NAME}" -Atqc \
          "SELECT COUNT(*) FROM public.\"user\" WHERE id = ${target_id}")"
        quiz_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d quiz -Atqc \
          "SELECT COUNT(*) FROM public.quiz WHERE id = ${quiz_id}")"
        quiz_user_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d quiz -Atqc \
          "SELECT COUNT(*) FROM public.\"user\" WHERE auth_user_id = ${target_id}")"
        if [[ "${auth_count}" != 0 || "${quiz_count}" != 0 || "${quiz_user_count}" != 0 ]]; then
          rm -f "${cookie_file}"
          fail_test "deleted user or quiz data remains: auth=${auth_count}, quiz=${quiz_count}, quiz_user=${quiz_user_count}"
          return 1
        fi
      elif [[ "${response##*$'\n'}" != 403 ]]; then
        rm -f "${cookie_file}"
        fail_test "${role} role could list users: ${response}"
        return 1
      else
        response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
          --data '{"role":"admin"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}/role")"
        if [[ "${response##*$'\n'}" != 403 ]]; then
          rm -f "${cookie_file}"
          fail_test "${role} role could change account roles: ${response}"
          return 1
        fi
      fi
    done
  fi

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"  Geography  "}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  local quiz_id
  quiz_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e '.name == "Geography"' <<<"${response%$'\n'*}" >/dev/null || [[ -z "${quiz_id}" ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz creation failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${quiz_id}" '.quizzes | any(.id == $id and .name == "Geography")' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "created quiz missing from library: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"  "}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test 'blank quiz name was accepted'
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"  World map  "}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.name == "World map"' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz rename failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${quiz_id}" '.quizzes | any(.id == $id and .name == "World map")' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "renamed quiz missing from library: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"  "}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test 'blank quiz rename was accepted'
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz deletion failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 404 ]]; then
    rm -f "${cookie_file}"
    fail_test 'deleted quiz remained accessible'
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
register_test_case test_quiz_library_requires_login
register_test_case test_auth_users_requires_admin
register_test_case test_auth_login_session_lifecycle
