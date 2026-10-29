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
  api_request POST /api/quiz/quizzes/import '{"format":"softerr-quiz","version":1,"name":"Geography","description":"","questions":[],"images":[]}'
  assert_status 401 || return 1
  api_request GET /api/quiz/images
  assert_status 401 || return 1
  api_request GET /api/media/images
  assert_status 401 || return 1
  api_request GET /api/quiz/images/1
  assert_status 401 || return 1
  api_request DELETE /api/quiz/images/1
  assert_status 401 || return 1
  api_request GET /api/quiz/quizzes/1/export.zip
  assert_status 401 || return 1
  api_request PATCH /api/quiz/quizzes/1 '{"name":"Updated"}'
  assert_status 401 || return 1
  api_request DELETE /api/quiz/quizzes/1
  assert_status 401 || return 1
}

test_auth_users_requires_admin() {
  api_request GET /api/auth/users
  assert_status 401 || return 1
  api_request GET /api/auth/backups
  assert_status 401 || return 1
  api_request GET /api/auth/backups/19700101T000000Z/download
  assert_status 401 || return 1
  api_request POST /api/auth/users '{}'
  assert_status 405 || return 1
  api_request PATCH /api/auth/users/1/role '{"role":"mod"}'
  assert_status 401 || return 1
  api_request GET /api/auth/users/1/role
  assert_status 405 || return 1
  api_request POST /api/auth/users/1/approve
  assert_status 401 || return 1
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

  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')"
  api_request POST /api/auth/login "${body}"
  assert_status 403 || return 1
  assert_json_value '.error' 'Your account is awaiting admin approval' || return 1
  local escaped_approval_email
  escaped_approval_email="$(sql_escape_literal "${TEST_EMAIL}")"
  if ! sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -v ON_ERROR_STOP=1 \
    -d "${API_TEST_DB_NAME}" -c "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP WHERE email = '${escaped_approval_email}'" >/dev/null; then
    fail_test 'could not approve test account for session tests'
    return 1
  fi

  local cookie_file headers body response status response_body current_id
  cookie_file="$(mktemp)"
  headers="$(mktemp)"
  body="$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')"
  response="$(curl -sS -c "${cookie_file}" -D "${headers}" -H 'Content-Type: application/json' \
    --data "${body}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  status="${response##*$'\n'}"
  response_body="${response%$'\n'*}"
  current_id="$(jq -r '.id // empty' <<<"${response_body}")"
  if [[ "${status}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" '.email == $email and .role == "user" and .verified == true and .approved == true' <<<"${response_body}" >/dev/null; then
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
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/backups")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    rm -f "${cookie_file}"
    fail_test "user role could list backups: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/backups/19700101T000000Z/download")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    rm -f "${cookie_file}"
    fail_test "user role could download backups: ${response}"
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
        response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/backups")"
        if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.backups | type == "array"' \
          <<<"${response%$'\n'*}" >/dev/null; then
          rm -f "${cookie_file}"
          fail_test "admin could not list backups: ${response}"
          return 1
        fi
        local backup_id backup_zip backup_status
        backup_id="$(jq -r '.backups[0].id // empty' <<<"${response%$'\n'*}")"
        if [[ -z "${backup_id}" ]]; then
          rm -f "${cookie_file}"
          fail_test 'admin backup list contained no complete backup sets'
          return 1
        fi
        backup_zip="$(mktemp --suffix=.zip)"
        backup_status="$(curl -sS -b "${cookie_file}" -o "${backup_zip}" -w '%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/backups/${backup_id}/download")"
        if [[ "${backup_status}" != 200 ]] || ! php -r '
          $zip = new ZipArchive();
          if ($zip->open($argv[1]) !== true) exit(1);
          $names = [];
          for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = $zip->statIndex($i);
            if ($entry["size"] < 1) exit(1);
            $names[] = $entry["name"];
          }
          sort($names);
          exit($names === ["auth.dump", "media.dump", "quiz.dump"] ? 0 : 1);
        ' "${backup_zip}"; then
          rm -f "${backup_zip}" "${cookie_file}"
          fail_test "admin backup download was incomplete: HTTP ${backup_status}"
          return 1
        fi
        rm -f "${backup_zip}"
        response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}/approve")"
        if [[ "${response##*$'\n'}" != 409 ]]; then
          rm -f "${cookie_file}"
          fail_test "admin could approve unverified account: ${response}"
          return 1
        fi
        fetch_verify_token_for_email "${target_email}" || { rm -f "${cookie_file}"; return 1; }
        api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
        assert_status 200 || { rm -f "${cookie_file}"; return 1; }
        local queued_notice
        queued_notice="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -X -At \
          -d "${API_TEST_DB_NAME}" -c "SELECT count(*) FROM public.approval_email_outbox WHERE applicant_id = ${target_id} AND recipient_id = ${current_id}")"
        if [[ -n "${API_TEST_MAILPIT_URL:-}" ]]; then
          sudo -n systemctl start softerr-send-email.service
          local approval_mail=''
          approval_mail="$(curl -fsS --max-time 5 -G \
            --data-urlencode "query=to:${TEST_EMAIL}" \
            "${API_TEST_MAILPIT_URL%/}/view/latest.txt" 2>/dev/null)" || true
          if [[ "${approval_mail}" != *"${target_email}"* ]] \
            || [[ "${approval_mail}" != *'waiting for account approval'* ]]; then
            rm -f "${cookie_file}"
            fail_test 'admin approval email was not delivered'
            return 1
          fi
        elif [[ "${queued_notice}" != 1 ]]; then
          rm -f "${cookie_file}"
          fail_test 'verification did not queue an admin approval email'
          return 1
        fi
        response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
          "${API_TEST_BASE_URL%/}/api/auth/users/${target_id}/approve")"
        if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.verified == true and .approved == true' \
          <<<"${response%$'\n'*}" >/dev/null; then
          rm -f "${cookie_file}"
          fail_test "admin could not approve verified account: ${response}"
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
        response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/backups")"
        if [[ "${response##*$'\n'}" != 403 ]]; then
          rm -f "${cookie_file}"
          fail_test "${role} role could list backups: ${response}"
          return 1
        fi
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
    '.name == "Geography" and .description == "" and .play_style == "basic" and .show_correct_answers == false' \
    <<<"${response%$'\n'*}" >/dev/null || [[ -z "${quiz_id}" ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz creation failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${quiz_id}" '.quizzes | any(.id == $id and .name == "Geography" and .play_count == 0)' <<<"${response%$'\n'*}" >/dev/null; then
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
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Invalid style","play_style":"playful"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test 'invalid quiz play style was accepted'
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Invalid review setting","show_correct_answers":"yes"}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test 'invalid quiz review setting was accepted'
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
    --data '{"name":"World map","description":"  Countries and capitals  ","play_style":"game_show","show_correct_answers":true}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.description == "Countries and capitals" and .play_style == "game_show" and .show_correct_answers == true' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz description or template update failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.description == "Countries and capitals" and .play_style == "game_show" and .show_correct_answers == true' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz editor fields were not saved: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${quiz_id}" \
    '.quizzes | any(.id == $id and .name == "World map" and .description == "Countries and capitals" and .play_style == "game_show" and .show_correct_answers == true)' \
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
    '{"template":"ordering","prompt":"Put the steps in order","config":{"items":[{"text":"Wash"},{"text":"Cut"},{"text":"Cook"}]}}'
    '{"template":"fill_blanks","prompt":"France: {{1}}; Italy: {{2}}","config":{"answers":[{"text":"Paris"},{"text":"Rome"}]}}'
    '{"template":"categorize","prompt":"Sort the animals","config":{"categories":[{"name":"Mammals","items":[{"text":"Dog"},{"text":"Cat"}]},{"name":"Birds","items":[{"text":"Eagle"}]}]}}'
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
    '.questions | length == 13 and .[0].template == "multiple_choice" and .[10].config.items == [{"text":"Wash"}, {"text":"Cut"}, {"text":"Cook"}] and .[11].config.answers == [{"text":"Paris"}, {"text":"Rome"}] and .[12].config.categories[0].items == [{"text":"Dog"}, {"text":"Cat"}]' \
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
  local attempt_path attempt_id resumed_id attempt_question_id resumed_question_id
  attempt_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/attempts"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  attempt_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || -z "${attempt_id}" ]] || ! jq -e \
    --argjson id "${question_id}" \
    '.play_style == "game_show" and .question_count == 13 and (.questions | length) == 1 and .questions[0].config.categories[0].items == null' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "could not start quiz attempt: ${response}"
    return 1
  fi
  attempt_question_id="$(jq -r '.questions[0].id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"selected":[0]}}' -w $'\n%{http_code}' \
    "${attempt_path}/${attempt_id}/answers/${attempt_question_id}")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    rm -f "${cookie_file}"
    fail_test "could not save quiz answer: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  resumed_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || "${resumed_id}" != "${attempt_id}" ]] || ! jq -e \
    --arg id "${attempt_question_id}" '.answers[$id].selected == [0]' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz attempt did not resume saved answer: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.play_count == 1' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "resuming an attempt changed the play count: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${attempt_id}/complete")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.completed != null' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "could not complete quiz attempt: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${attempt_path}/${attempt_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg id "${attempt_question_id}" \
    '.completed != null and .answers[$id].selected == [0]' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "completed quiz answer was not retained: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"selected":[1]}}' -w $'\n%{http_code}' \
    "${attempt_path}/${attempt_id}/answers/${attempt_question_id}")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}"
    fail_test "completed quiz attempt accepted an answer: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  resumed_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  resumed_question_id="$(jq -r '.questions[0].id' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || -z "${resumed_id}" || "${resumed_id}" == "${attempt_id}" ]]; then
    rm -f "${cookie_file}"
    fail_test "new quiz attempt was not created: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${attempt_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    --argjson current "${resumed_id}" --argjson previous "${attempt_id}" \
    '.attempts | length == 2 and .[0].id == $current and .[0].completed == null and .[0].question_count == 13 and .[1].id == $previous and .[1].completed != null' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz attempt history is incomplete: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.play_count == 2' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "starting a second attempt did not increase the play count: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${attempt_path}?before=${resumed_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson previous "${attempt_id}" \
    '.attempts | length == 1 and .[0].id == $previous' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz attempt pagination failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{}}' -w $'\n%{http_code}' \
    "${attempt_path}/${resumed_id}/answers/${resumed_question_id}")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    rm -f "${cookie_file}"
    fail_test "empty quiz answer object was rejected: ${response}"
    return 1
  fi
  # Question appearances retain separate answers when a source repeats.
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${resumed_id}/complete")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    fail_test "could not finish active attempt before sequence checks: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","randomize_questions":true,"question_limit":null}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    fail_test "could not configure randomized All mode: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  local all_attempt_id all_sources
  all_attempt_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  all_sources="$(test_psql quiz "SELECT json_agg(source_question_id ORDER BY source_question_id) FROM public.quiz_attempt_question WHERE attempt_id = ${all_attempt_id};")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '(.questions | length) == 1 and .question_count == 13 and .randomize_questions == true and .question_limit == null' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "randomized All mode repeated or omitted a source: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${all_attempt_id}/complete")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    fail_test "could not finish randomized All attempt: ${response}"
    return 1
  fi
  if ! jq -e '(.questions | length) == 13 and ([.questions[].source_question_id] | unique | length) == 13' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "randomized All mode repeated or omitted a source: ${response}"; return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","randomize_questions":false,"question_limit":0}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    fail_test "could not configure unlimited ordered mode: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  local infinite_attempt_id first_source first_instance next_instance step
  infinite_attempt_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  first_instance="$(jq -r '.questions[0].id' <<<"${response%$'\n'*}")"
  first_source="$(jq -r '.questions[0].source_question_id' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '(.questions | length) == 1 and .question_limit == 0' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "unlimited attempt did not start with one question: ${response}"
    return 1
  fi
  next_instance="${first_instance}"
  for step in {1..13}; do
    response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
      --data "{\"after\":${next_instance}}" -w $'\n%{http_code}' \
      "${attempt_path}/${infinite_attempt_id}/next")"
    next_instance="$(jq -r '.questions[-1].id // empty' <<<"${response%$'\n'*}")"
    if [[ "${response##*$'\n'}" != 200 || -z "${next_instance}" ]]; then
      fail_test "unlimited attempt could not advance: ${response}"
      return 1
    fi
  done
  if ! jq -e --argjson source "${first_source}" \
    '(.questions | length) == 14 and .questions[13].source_question_id == $source and ([.questions[].id] | unique | length) == 14' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "unlimited ordered mode did not cycle: ${response}"
    return 1
  fi
  local repeated_instance
  repeated_instance="${next_instance}"
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"text":"first"}}' -w $'\n%{http_code}' \
    "${attempt_path}/${infinite_attempt_id}/answers/${first_instance}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not save first repeated answer: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"text":"second"}}' -w $'\n%{http_code}' \
    "${attempt_path}/${infinite_attempt_id}/answers/${repeated_instance}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not save second repeated answer: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${attempt_path}/${infinite_attempt_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    --arg first "${first_instance}" --arg second "${repeated_instance}" \
    '.answers[$first].text == "first" and .answers[$second].text == "second"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "repeated questions did not retain separate answers: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${infinite_attempt_id}/complete")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not finish unlimited attempt: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","randomize_questions":true,"question_limit":0}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not configure unlimited random mode: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  local random_attempt_id random_after
  random_attempt_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  random_after="$(jq -r '.questions[0].id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data "{\"after\":${random_after}}" -w $'\n%{http_code}' \
    "${attempt_path}/${random_attempt_id}/next")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson sources "${all_sources}" \
    '(.questions | length) == 2 and .questions[0].source_question_id != .questions[1].source_question_id and all(.questions[]; .source_question_id as $id | $sources | index($id) != null)' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "unlimited random mode did not append a bank question: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${random_attempt_id}/complete")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not finish unlimited random attempt: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","randomize_questions":false,"question_limit":15}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not configure fixed count: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '(.questions | length) == 1 and .question_count == 15' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "fixed count did not cycle in order: ${response}"
    return 1
  fi
  local ordered_attempt_id
  ordered_attempt_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${ordered_attempt_id}/complete")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not finish fixed ordered attempt: ${response}"; return 1; }
  jq -e '(.questions | length) == 15 and .questions[0].source_question_id == .questions[13].source_question_id and ([.questions[].id] | unique | length) == 15' \
    <<<"${response%$'\n'*}" >/dev/null || { fail_test "fixed count did not cycle in order: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"World map","randomize_questions":true,"question_limit":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not configure fixed random mode: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '(.questions | length) == 1 and .question_count == 30' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "fixed random mode repeated an adjacent question: ${response}"
    return 1
  fi
  local fixed_random_id
  fixed_random_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${attempt_path}/${fixed_random_id}/complete")"
  jq -e '((.questions | length) == 30) and ([.questions[].source_question_id] as $ids | all(range(1; ($ids | length)); $ids[.] != $ids[. - 1]))' \
    <<<"${response%$'\n'*}" >/dev/null || { fail_test "fixed random mode repeated an adjacent question: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data "{\"after\":${random_after}}" -w $'\n%{http_code}' \
    "${attempt_path}/${random_attempt_id}/next")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    fail_test "completed random attempt accepted next question: ${response}"
    return 1
  fi
  local boundary_template boundary_key boundary_payload
  for boundary_template in multiple_choice match ordering fill_blanks categorize; do
    case "${boundary_template}" in
      multiple_choice)
        boundary_key=options
        boundary_payload="$(jq -nc '{template:"multiple_choice",prompt:"Pick one",config:{options:[range(1;41) as $i | {text:("Option \($i)"),correct:($i==1)}]}}')"
        ;;
      match)
        boundary_key=pairs
        boundary_payload="$(jq -nc '{template:"match",prompt:"Match all",config:{pairs:[range(1;41) as $i | {keyword:("K"*120+"\($i)"),definition:("D"*120+"\($i)")}]}}')"
        ;;
      ordering)
        boundary_key=items
        boundary_payload="$(jq -nc '{template:"ordering",prompt:"Order all",config:{items:[range(1;41) | {text:("Item \(.)")}]}}')"
        ;;
      fill_blanks)
        boundary_key=answers
        boundary_payload="$(jq -nc '{template:"fill_blanks",prompt:([range(1;41) | "{{\(.)}}"] | join(" ")),config:{answers:[range(1;41) | {text:("Answer \(.)")}]}}')"
        ;;
      categorize)
        boundary_key=categories
        boundary_payload="$(jq -nc '{template:"categorize",prompt:"Sort all",config:{categories:[range(1;41) as $i | {name:("Category \($i)"),items:[{text:("Item \($i)") }]}]}}')"
        ;;
    esac
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "${boundary_payload}" -w $'\n%{http_code}' "${question_path}")"
    if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e --arg key "${boundary_key}" \
      '.config[$key] | length == 40' <<<"${response%$'\n'*}" >/dev/null; then
      rm -f "${cookie_file}"
      fail_test "${boundary_template} did not accept 40 entries: ${response}"
      return 1
    fi
  done
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
    '{"template":"ordering","prompt":"Order","config":{"items":[{"text":"Same"},{"text":"Same"}]}}' \
    '{"template":"fill_blanks","prompt":"Missing marker","config":{"answers":[{"text":"Answer"}]}}' \
    '{"template":"categorize","prompt":"Sort","config":{"categories":[{"name":"A","items":[{"text":"Same"}]},{"name":"B","items":[{"text":"Same"}]}]}}'; do
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "${invalid_question}" -w $'\n%{http_code}' "${question_path}")"
    if [[ "${response##*$'\n'}" != 400 ]]; then
      rm -f "${cookie_file}"
      fail_test "invalid question template config was accepted: ${response}"
      return 1
    fi
  done

  local import_path import_id import_body
  import_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/import"
  import_body='{"format":"softerr-quiz","version":1,"name":"Imported quiz","description":"From JSON","play_style":"game_show","show_correct_answers":true,"randomize_questions":true,"randomize_answers":true,"question_limit":0,"questions":[{"template":"no_answer","prompt":"First","config":{}},{"template":"ordering","prompt":"Second","config":{"items":[{"text":"A"},{"text":"B"}]}}],"images":[]}'
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "${import_body}" -w $'\n%{http_code}' "${import_path}")"
  import_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || -z "${import_id}" ]] || ! jq -e \
    '.name == "Imported quiz" and .description == "From JSON" and .play_style == "game_show" and .show_correct_answers == true and .randomize_questions == true and .randomize_answers == true and .question_limit == 0' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz import failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${import_id}/questions")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.questions | length == 2 and .[0].prompt == "First" and .[1].config.items == [{"text":"A"}, {"text":"B"}]' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "imported questions were not saved in order: ${response}"
    return 1
  fi
  local zip_file zip_import_id
  zip_file="$(mktemp --suffix=.zip)"
  response="$(curl -sS -b "${cookie_file}" -o "${zip_file}" -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${import_id}/export.zip")"
  if [[ "${response}" != 200 ]] || ! php -r '
    $zip = new ZipArchive();
    if ($zip->open($argv[1]) !== true) exit(1);
    $json = $zip->getFromName("quiz.json");
    $manifest = json_decode($json, true);
    exit(($manifest["version"] ?? null) === 1
      && ($manifest["play_style"] ?? null) === "game_show"
      && ($manifest["show_correct_answers"] ?? null) === true
      && ($manifest["randomize_questions"] ?? null) === true
      && ($manifest["randomize_answers"] ?? null) === true
      && ($manifest["question_limit"] ?? null) === 0
      && count($manifest["questions"] ?? []) === 2
      && str_contains($json, "\n    \"version\": 1,") ? 0 : 1);
  ' "${zip_file}"; then
    rm -f "${zip_file}" "${cookie_file}"
    fail_test "quiz ZIP export failed: HTTP ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/octet-stream' \
    --data-binary "@${zip_file}" -w $'\n%{http_code}' "${import_path}")"
  rm -f "${zip_file}"
  zip_import_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || -z "${zip_import_id}" ]] || ! jq -e '.play_style == "game_show" and .show_correct_answers == true and .randomize_questions == true and .randomize_answers == true and .question_limit == 0' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "quiz ZIP import failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${zip_import_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "ZIP imported quiz deletion failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"format":"softerr-quiz","version":3,"name":"Old format","description":"","questions":[],"images":[]}' \
    -w $'\n%{http_code}' "${import_path}")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test "old quiz format was accepted: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"format":"softerr-quiz","version":1,"name":"Invalid import","description":"","questions":[{"template":"no_answer","prompt":"First","config":{}},{"template":"ordering","prompt":"Bad","config":{"items":[{"text":"Same"},{"text":"Same"}]}}],"images":[]}' \
    -w $'\n%{http_code}' "${import_path}")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}"
    fail_test "invalid quiz import was accepted: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.quizzes | all(.name != "Invalid import")' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "invalid import left a partial quiz: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${import_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "imported quiz deletion failed: ${response}"
    return 1
  fi

  import_body="$(jq -nc '{format:"softerr-quiz",version:1,name:"Large import",description:"",questions:[range(0;30) as $i | {template:"open",prompt:("Question \($i)"),config:{sample_answer:("x"*180)}}],images:[]}')"
  if (( ${#import_body} <= 4096 )); then
    rm -f "${cookie_file}"
    fail_test 'large import test body did not exceed the regular 4096-byte limit'
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "${import_body}" -w $'\n%{http_code}' "${import_path}")"
  import_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || -z "${import_id}" ]]; then
    rm -f "${cookie_file}"
    fail_test "large quiz import failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${import_id}/questions")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.questions | length == 30 and .[0].prompt == "Question 0" and .[29].prompt == "Question 29"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "large quiz import lost questions: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${import_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "large imported quiz deletion failed: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${question_path}/${question_id}")"
  if [[ "${response##*$'\n'}" != 204 ]]; then
    rm -f "${cookie_file}"
    fail_test "quiz question deletion failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${attempt_path}/${attempt_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg id "${attempt_question_id}" \
    '.answers[$id].selected == [0] and any(.questions[]; .prompt == "Pick one prime")' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}"
    fail_test "deleted question was lost from attempt review: ${response}"
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

  local locked_quiz_id locked_attempt_id locked_first locked_second locked_path
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Forward only"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  locked_quiz_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || -z "${locked_quiz_id}" ]] || ! jq -e '.allow_go_back == true' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "forward-only quiz creation failed: ${response}"; return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Forward only","allow_go_back":false}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${locked_quiz_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.allow_go_back == false' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "forward-only setting update failed: ${response}"; return 1
  fi
  for prompt in First Second; do
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "{\"template\":\"no_answer\",\"prompt\":\"${prompt}\",\"config\":{}}" \
      -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${locked_quiz_id}/questions")"
    [[ "${response##*$'\n'}" == 201 ]] || { fail_test "forward-only question creation failed: ${response}"; return 1; }
  done
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${locked_quiz_id}/attempts")"
  locked_attempt_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  locked_first="$(jq -r '.questions[0].id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && -n "${locked_first}" ]] || { fail_test "forward-only attempt failed: ${response}"; return 1; }
  locked_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/${locked_quiz_id}/attempts/${locked_attempt_id}"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${locked_path}/questions/${locked_first}/start")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "first question did not open: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"viewed":true}}' -w $'\n%{http_code}' "${locked_path}/answers/${locked_first}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "first answer was not saved: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data "{\"after\":${locked_first}}" -w $'\n%{http_code}' "${locked_path}/next")"
  locked_second="$(jq -r '.questions[1].id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && -n "${locked_second}" ]] || { fail_test "second question did not load: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${locked_path}/questions/${locked_second}/start")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second question did not open: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"viewed":false}}' -w $'\n%{http_code}' "${locked_path}/answers/${locked_first}")"
  if [[ "${response##*$'\n'}" != 409 ]] || ! jq -e '.error == "Going back is disabled"' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "earlier answer could be changed: ${response}"; return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${locked_path}/questions/${locked_first}/start")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test "earlier question reopened: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"viewed":true}}' -w $'\n%{http_code}' "${locked_path}/answers/${locked_second}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "current answer was rejected: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${locked_quiz_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "forward-only quiz cleanup failed: ${response}"; return 1; }

  local timed_quiz_id timed_attempt_id timed_instance_id timed_deadline timed_path
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Timed quiz","time_limit_seconds":4}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  timed_quiz_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && -n "${timed_quiz_id}" ]] || { fail_test "timed quiz creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"template":"no_answer","prompt":"Read this","config":{},"time_limit_seconds":1}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${timed_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "timed question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${timed_quiz_id}/attempts")"
  timed_attempt_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  timed_instance_id="$(jq -r '.questions[0].id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || -z "${timed_instance_id}" ]] || ! jq -e \
    '.time_limit_seconds == 4 and .deadline_ms != null and .questions[0].time_limit_seconds == 1' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "timed attempt snapshot failed: ${response}"; return 1
  fi
  timed_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/${timed_quiz_id}/attempts/${timed_attempt_id}"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${timed_path}/questions/${timed_instance_id}/start")"
  timed_deadline="$(jq -r '.questions[0].deadline_ms // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && -n "${timed_deadline}" ]] || { fail_test "question clock did not start: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${timed_path}/questions/${timed_instance_id}/start")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson deadline "${timed_deadline}" \
    '.questions[0].deadline_ms == $deadline' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "question clock reset: ${response}"; return 1
  fi
  sleep 2
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"viewed":true}}' -w $'\n%{http_code}' \
    "${timed_path}/answers/${timed_instance_id}")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test "expired question accepted answer: ${response}"; return 1; }
  sleep 2
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${timed_path}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.completed != null' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "expired quiz remained active: ${response}"; return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${timed_quiz_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "timed quiz cleanup failed: ${response}"; return 1; }

  local secret_quiz_id secret_attempt_id secret_first secret_second secret_reveal secret_path hidden_second secret_choice_index
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Server scoring check","show_correct_answers":false,"randomize_answers":true}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  secret_quiz_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$secret_quiz_id" =~ ^[0-9]+$ ]] || { fail_test "scoring quiz creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"template":"one_choice","prompt":"Pick the prime","config":{"options":[{"text":"4","correct":false},{"text":"2","correct":true}]}}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "first scoring question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"template":"number","prompt":"Answer the next question","config":{"answer":"42"}}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "second scoring question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"template":"show_answer","prompt":"Reveal the phrase","config":{"answer":"Hidden phrase"}}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "reveal question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}/attempts")"
  secret_attempt_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  secret_first="$(jq -r '.questions[0].id // empty' <<<"${response%$'\n'*}")"
  secret_choice_index="$(jq -r '[.questions[0].config.options[].text] | index("2")' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e \
    '.question_count == 3 and .randomize_answers == true and (.questions | length) == 1 and .questions[0].prompt == "Pick the prime" and
      (.questions[0].config.options | all(has("correct") | not)) and .score == null' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "active attempt exposed answers or a future question: ${response}"; return 1; }
  [[ "$secret_choice_index" =~ ^[0-9]+$ ]] || { fail_test "correct choice missing from play presentation: ${response}"; return 1; }
  secret_path="${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}/attempts/${secret_attempt_id}"
  hidden_second="$(test_psql quiz "SELECT id FROM public.quiz_attempt_question WHERE attempt_id = ${secret_attempt_id} AND position = 2;")"
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${secret_path}/questions/${hidden_second}/start")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "future question was opened early: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson selected "$secret_choice_index" '{answer:{selected:[$selected]}}')" \
    -w $'\n%{http_code}' "${secret_path}/answers/${secret_first}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "first scoring answer was not saved: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Server scoring check","randomize_answers":false}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e '.randomize_answers == false' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "answer randomization setting did not update: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data "{\"after\":${secret_first}}" -w $'\n%{http_code}' "${secret_path}/next")"
  secret_second="$(jq -r '.questions[1].id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && "$secret_second" == "$hidden_second" ]] && jq -e \
    '(.questions | length) == 2 and .randomize_answers == true and (.questions[1].config | has("answer") | not) and .score == null' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "next question exposed its answer: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"answer":{"text":"41"}}' -w $'\n%{http_code}' "${secret_path}/answers/${secret_second}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second scoring answer was not saved: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data "{\"after\":${secret_second}}" -w $'\n%{http_code}' "${secret_path}/next")"
  secret_reveal="$(jq -r '.questions[2].id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && "$secret_reveal" =~ ^[0-9]+$ ]] && jq -e \
    '(.questions[2].config | has("answer") | not)' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "Show answer content leaked before reveal: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' \
    "${secret_path}/questions/${secret_reveal}/reveal")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e '.answer == "Hidden phrase"' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "Show answer reveal failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -w $'\n%{http_code}' "${secret_path}/complete")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e \
    '.score == {graded:2,correct:1,ungraded:1} and (.questions | all(has("solution") | not)) and .questions[2].config.answer == "Hidden phrase"' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "server score or hidden solution was incorrect: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Server scoring check","show_correct_answers":true}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "review setting update failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' "${secret_path}")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e \
    '.questions[0].solution.options[1].correct == true and .questions[1].solution.answer == "42"' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "permitted review omitted solutions: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${secret_quiz_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "scoring quiz cleanup failed: ${response}"; return 1; }

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
