#!/usr/bin/env bash

test_user_api_tokens() (
  set -e
  sudo -n systemctl restart nginx
  local owner_name other_name hash owner_id other_id owner_cookie other_cookie response quiz_id token token_id service_id
  owner_name="api_test_${API_TEST_RUN_ID}_token_owner"
  other_name="api_test_${API_TEST_RUN_ID}_token_other"
  hash="$(php -r 'echo password_hash("test_password_123", PASSWORD_DEFAULT);')"
  owner_id="$(test_psql auth "INSERT INTO public.\"user\" (username, email, password, verified, approved_at)
    VALUES ('${owner_name}', '${owner_name}@example.test', '${hash}', TRUE, CURRENT_TIMESTAMP) RETURNING id;")"
  other_id="$(test_psql auth "INSERT INTO public.\"user\" (username, email, password, verified, approved_at)
    VALUES ('${other_name}', '${other_name}@example.test', '${hash}', TRUE, CURRENT_TIMESTAMP) RETURNING id;")"
  [[ "$owner_id" =~ ^[1-9][0-9]*$ && "$other_id" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test 'could not create token test users'; return 1; }
  owner_cookie="$(mktemp)"
  other_cookie="$(mktemp)"
  local image_file second_image_file
  image_file="$(mktemp)"
  second_image_file="$(mktemp)"
  trap 'rm -f "$owner_cookie" "$other_cookie" "$image_file" "$second_image_file"' EXIT
  for name in "$owner_name" "$other_name"; do
    local cookie="$other_cookie"
    [[ "$name" == "$owner_name" ]] && cookie="$owner_cookie"
    response="$(curl -sS -c "$cookie" -H 'Content-Type: application/json' \
      --data "$(jq -nc --arg email "${name}@example.test" \
        '{email:$email,password:"test_password_123"}')" \
      -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
    [[ "${response##*$'\n'}" == 200 ]] || { fail_test "token test login failed: ${response}"; return 1; }
  done

  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Private original"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "owner quiz creation failed: ${response}"; return 1; }
  quiz_id="$(jq -r '.id' <<<"${response%$'\n'*}")"

  response="$(curl -sS -H 'Content-Type: application/json' \
    --data '{"name":"Anonymous","scopes":["quiz:read"],"expires_in_days":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test "anonymous created token: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"No scope","scopes":["admin:all"],"expires_in_days":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "invalid scope accepted: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Missing read","scopes":["quiz:write"],"quiz_access":{"all":"read","quizzes":[]},"expires_in_days":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "owner quiz read without scope accepted: ${response}"; return 1; }

  response="$(curl -sS -b "$other_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Other bot","scopes":["quiz:read"],"quiz_access":{"all":"read","quizzes":[]},"expires_in_days":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "regular user could not create token: ${response}"; return 1; }
  local other_token
  other_token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "$other_cookie" "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  jq -e '.tokens | length == 1' <<<"$response" >/dev/null \
    || { fail_test "token list included another user's tokens: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${other_token}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "other token saw private quiz: ${response}"; return 1; }

  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"No owner access","scopes":["quiz:read"],"quiz_access":{"all":"none","quizzes":[]},"expires_in_days":30}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "restricted token creation failed: ${response}"; return 1; }
  token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H "Authorization: Bearer ${token}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "restricted token saw owner quiz: ${response}"; return 1; }

  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Study bot","scopes":["quiz:read","quiz:write","media:read"],"quiz_access":{"all":"read","quizzes":[]},"expires_in_days":null}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "service token creation failed: ${response}"; return 1; }
  jq -e '.expires == null and (.user_id | type == "number")' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "service account or never expiry missing: ${response}"; return 1; }
  token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  token_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  service_id="$(jq -r '.user_id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "$other_cookie" "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  jq -e --argjson id "$token_id" '.tokens | length == 1 and all(.id != $id)' \
    <<<"$response" >/dev/null \
    || { fail_test "other user listed owner's token: ${response}"; return 1; }
  [[ "$(test_psql auth "SELECT account_kind = 'service' AND service_owner_id = ${owner_id}
      AND email IS NULL AND password IS NULL AND display_name = 'Study bot'
      FROM public.\"user\" WHERE id = ${service_id};")" == t ]] \
    || { fail_test 'service account has login credentials or wrong owner'; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/me")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson id "$service_id" --argjson token_id "$token_id" \
      '.id == $id and .username == "Study bot" and .account_kind == "service" and .api_token_id == $token_id' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "token identity is not its service account: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  jq -e --argjson id "$quiz_id" '.quizzes | any(.id == $id)' <<<"$response" >/dev/null \
    || { fail_test "opted-in token cannot list owner quiz: ${response}"; return 1; }
  for path in "/api/quiz/quizzes/${quiz_id}" "/api/quiz/quizzes/${quiz_id}/questions"; do
    response="$(curl -sS -H "Authorization: Bearer ${token}" -w $'\n%{http_code}' \
      "${API_TEST_BASE_URL%/}${path}")"
    [[ "${response##*$'\n'}" == 200 ]] || { fail_test "token cannot read ${path}: ${response}"; return 1; }
  done
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' \
    | base64 -d > "$image_file"
  cp "$image_file" "$second_image_file"
  printf 'second' >> "$second_image_file"
  response="$(curl -sS -b "$owner_cookie" --data-binary @"$image_file" \
    -H 'X-Image-Name: owner-token-test.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "owner image upload failed: ${response}"; return 1; }
  local image_id
  image_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$image_id" \
      '{template:"no_answer",prompt:"Picture",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "owner image question failed: ${response}"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/media/images/${image_id}")" == 200 ]] \
    || { fail_test 'opted-in token could not read quiz image'; return 1; }
  local second_quiz_id
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Another private quiz"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "second quiz creation failed: ${response}"; return 1; }
  second_quiz_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  local second_image_id
  response="$(curl -sS -b "$owner_cookie" --data-binary @"$second_image_file" \
    -H 'X-Image-Name: second-token-test.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "second image upload failed: ${response}"; return 1; }
  second_image_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$second_image_id" \
      '{template:"no_answer",prompt:"Second picture",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "second image question failed: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Another private quiz","is_public":true}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second quiz publishing failed: ${response}"; return 1; }
  local old_attempt_id
  response="$(curl -sS -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}/attempts")"
  [[ "${response##*$'\n'}" == 201 || "${response##*$'\n'}" == 200 ]] \
    || { fail_test "token could not start public quiz: ${response}"; return 1; }
  old_attempt_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Another private quiz","is_public":false}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second quiz privacy update failed: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$quiz_id" '{quiz_access:{all:"none",quizzes:[{id:$id,permission:"read"}]}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/quiz-access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "selected read grant failed: ${response}"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")" == 200 ]] \
    || { fail_test 'selected quiz unreadable'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}")" == 404 ]] \
    || { fail_test 'token read unselected quiz'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/media/images/${second_image_id}")" == 404 ]] \
    || { fail_test 'token read image from unselected quiz'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}/attempts/${old_attempt_id}")" == 404 ]] \
    || { fail_test 'old attempt bypassed narrowed quiz grant'; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  jq -e --argjson allowed "$quiz_id" --argjson denied "$second_quiz_id" \
    '.quizzes | any(.id == $allowed) and all(.id != $denied)' <<<"$response" >/dev/null \
    || { fail_test "quiz list ignored selected grant: ${response}"; return 1; }
  response="$(curl -sS -b "$other_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"quiz_access":{"all":"edit","quizzes":[]}}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/quiz-access")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "other user changed token access: ${response}"; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{"name":"Must stay private"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "token edited owner's quiz: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$quiz_id" '{quiz_access:{all:"none",quizzes:[{id:$id,permission:"edit"}]}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/quiz-access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "selected edit grant failed: ${response}"; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{"name":"Edited by bot"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "selected edit could not update quiz: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$image_id" \
      '{template:"no_answer",prompt:"Allowed picture",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "selected edit could not add question: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$second_image_id" \
      '{template:"no_answer",prompt:"Unrelated picture",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "token attached image from unselected quiz: ${response}"; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{"name":"Must stay private"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "selected edit changed other quiz: ${response}"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer ${token}" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}")" == 404 ]] \
    || { fail_test 'edit grant allowed deleting owner quiz'; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"quiz_access":{"all":"edit","quizzes":[]}}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/quiz-access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "all edit grant failed: ${response}"; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{"name":"Edited by bot too"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${second_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "all edit could not update second quiz: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
    --data '{"name":"Bot-created quiz"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "service account could not create quiz: ${response}"; return 1; }
  local bot_quiz_id
  bot_quiz_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  [[ "$(test_psql quiz "SELECT u.auth_user_id = ${service_id} FROM public.quiz q
    JOIN public.\"user\" u ON u.id = q.user_id WHERE q.id = ${bot_quiz_id};")" == t ]] \
    || { fail_test 'bot-created quiz does not belong to the service account'; return 1; }
  response="$(curl -sS -b "$owner_cookie" "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/activity")"
  jq -e --arg image_path "/api/media/images/${image_id}" \
    '.activity | any(.method == "POST" and .path == "/api/quiz/quizzes" and .status == 201)
      and any(.method == "GET" and .path == $image_path and .status == 200)' \
    <<<"$response" >/dev/null || { fail_test "token action was not attributed: ${response}"; return 1; }
  response="$(curl -sS -b "$other_cookie" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/activity")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "other user saw token activity: ${response}"; return 1; }
  response="$(curl -sS -b "$other_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "other user revoked token: ${response}"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "token revoke failed: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${token}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/me")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test "revoked token still worked: ${response}"; return 1; }
)

register_test_case test_user_api_tokens
