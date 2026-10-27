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
    local role escaped_email permission_result target_name target_email target_id desired_role target_cookie quiz_id target_question_id
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
        response="$(curl -sS -b "${target_cookie}" -H 'Content-Type: application/json' \
          --data '{"template":"no_answer","prompt":"Delete with owner","config":{}}' \
          -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
        target_question_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
        if [[ "${response##*$'\n'}" != 201 || -z "${target_question_id}" ]]; then
          rm -f "${cookie_file}" "${target_cookie}"
          fail_test "role target could not create question: ${response}"
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
        local auth_count quiz_count quiz_user_count question_count
        auth_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d "${API_TEST_DB_NAME}" -Atqc \
          "SELECT COUNT(*) FROM public.\"user\" WHERE id = ${target_id}")"
        quiz_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d quiz -Atqc \
          "SELECT COUNT(*) FROM public.quiz WHERE id = ${quiz_id}")"
        quiz_user_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d quiz -Atqc \
          "SELECT COUNT(*) FROM public.\"user\" WHERE auth_user_id = ${target_id}")"
        question_count="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -d quiz -Atqc \
          "SELECT COUNT(*) FROM public.question WHERE id = ${target_question_id}")"
        if [[ "${auth_count}" != 0 || "${quiz_count}" != 0 || "${quiz_user_count}" != 0 || "${question_count}" != 0 ]]; then
          rm -f "${cookie_file}"
          fail_test "deleted user or quiz data remains: auth=${auth_count}, quiz=${quiz_count}, quiz_user=${quiz_user_count}, question=${question_count}"
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
  if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e \
    '.name == "Geography" and .description == ""' \
    <<<"${response%$'\n'*}" >/dev/null || [[ -z "${quiz_id}" ]]; then
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
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.name == "Geography" and .description == ""' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz editor could not load quiz: ${response}"
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
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","description":"  Countries and capitals  "}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.description == "Countries and capitals"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz description or template update failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.description == "Countries and capitals"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz editor fields were not saved: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${quiz_id}" \
    '.quizzes | any(.id == $id and .name == "World map" and .description == "Countries and capitals")' \
    <<<"${response%$'\n'*}" >/dev/null; then
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

  local question_id question_path question_payload question_template
  local -a question_payloads=(
    '{"template":"multiple_choice","prompt":"Select the prime numbers","config":{"options":[{"text":"2","correct":true},{"text":"3","correct":true},{"text":"4","correct":false}]}}'
    '{"template":"one_choice","prompt":"Capital of France?","config":{"options":[{"text":"Paris","correct":true},{"text":"Rome","correct":false}]}}'
    '{"template":"number","prompt":"Two plus two?","config":{"answer":"4"}}'
    '{"template":"short_answer","prompt":"Name a color","config":{"answer":"Blue"}}'
    '{"template":"open","prompt":"Explain your reasoning","config":{"sample_answer":"Any clear explanation"}}'
    '{"template":"true_false","prompt":"Earth is round","config":{"answer":true}}'
    '{"template":"yes_no","prompt":"Is water wet?","config":{"answer":true}}'
    '{"template":"show_answer","prompt":"What is the secret?","config":{"answer":"42"}}'
    '{"template":"no_answer","prompt":"Read this fact","config":{}}'
    '{"template":"match","prompt":"Match capitals","config":{"pairs":[{"keyword":"France","definition":"Paris"},{"keyword":"Italy","definition":"Rome"}]}}'
    '{"template":"ordering","prompt":"Put the steps in order","config":{"items":["Wash","Cut","Cook"]}}'
    '{"template":"fill_blanks","prompt":"France: {{1}}; Italy: {{2}}","config":{"answers":["Paris","Rome"]}}'
    '{"template":"categorize","prompt":"Sort the animals","config":{"categories":[{"name":"Mammals","items":["Dog","Cat"]},{"name":"Birds","items":["Eagle"]}]}}'
  )
  question_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions"
  for question_payload in "${question_payloads[@]}"; do
    question_template="$(jq -r '.template' <<<"${question_payload}")"
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "${question_payload}" -w $'\n%{http_code}' "${question_path}")"
    if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e --arg template "${question_template}" \
      '.template == $template and (.id | type == "number") and (.config | type == "object")' \
      <<<"${response%$'\n'*}" >/dev/null; then
      rm -f "${cookie_file}"
      fail_test "could not add ${question_template} question: ${response}"
      return 1
    fi
    if [[ "${question_template}" == multiple_choice ]]; then
      question_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
    fi
  done
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${question_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.questions | length == 13 and .[0].template == "multiple_choice" and .[10].config.items == ["Wash", "Cut", "Cook"] and .[11].config.answers == ["Paris", "Rome"] and .[12].config.categories[0].items == ["Dog", "Cat"]' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz questions were not listed in order: ${response}"
    return 1
  fi
  local reordered_ids
  reordered_ids="$(jq -c '{question_ids: ([.questions[].id] | reverse)}' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "${reordered_ids}" -w $'\n%{http_code}' "${question_path}/order")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson expected "${reordered_ids}" \
    '.question_ids == $expected.question_ids' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz question reorder failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${question_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.questions | length == 13 and .[0].template == "categorize" and .[12].template == "multiple_choice"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz question order was not saved: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"question_ids\":[${question_id},${question_id}]}" \
    -w $'\n%{http_code}' "${question_path}/order")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz question reorder accepted duplicate IDs: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"template":"one_choice","prompt":"Pick one prime","config":{"options":[{"text":"2","correct":true},{"text":"4","correct":false}]}}' \
    -w $'\n%{http_code}' "${question_path}/${question_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.template == "one_choice" and .prompt == "Pick one prime" and (.config.options | length == 2)' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz question update failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"template":"one_choice","prompt":"Invalid","config":{"options":[{"text":"A","correct":true},{"text":"B","correct":true}]}}' \
    -w $'\n%{http_code}' "${question_path}")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test 'one-choice question accepted multiple correct answers'
    return 1
  fi
  local invalid_question
  for invalid_question in \
    '{"template":"ordering","prompt":"Order","config":{"items":["Same","Same"]}}' \
    '{"template":"fill_blanks","prompt":"Missing marker","config":{"answers":["Answer"]}}' \
    '{"template":"categorize","prompt":"Sort","config":{"categories":[{"name":"A","items":["Same"]},{"name":"B","items":["Same"]}]}}'; do
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "${invalid_question}" -w $'\n%{http_code}' "${question_path}")"
    if [[ "${response##*$'\n'}" != 400 ]]; then
      rm -f "${cookie_file}"
      fail_test "invalid question template config was accepted: ${response}"
      return 1
    fi
  done
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${question_path}/${question_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz question deletion failed: ${response}"
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
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 404 ]]; then
    rm -f "${cookie_file}"
    fail_test 'deleted quiz remained loadable'
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
