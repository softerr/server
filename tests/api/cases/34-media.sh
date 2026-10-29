#!/usr/bin/env bash

test_shared_media_across_users_and_quizzes() (
  set -e
  # Earlier login cases may have exhausted the per-IP Nginx bucket.
  sudo -n systemctl restart nginx
  local admin_email user_email admin_id user_id admin_cookie user_cookie png_file private_file answer_file direct_file folder_file large_file response status shared_id private_id answer_id direct_id folder_id group_id quiz_id history_quiz_id history_question_id public_attempt_id archive manifest count
  admin_cookie="$(mktemp)"
  user_cookie="$(mktemp)"
  png_file="$(mktemp)"
  private_file="$(mktemp)"
  answer_file="$(mktemp)"
  direct_file="$(mktemp)"
  folder_file="$(mktemp)"
  large_file="$(mktemp)"
  archive="$(mktemp)"
  trap 'rm -f "$admin_cookie" "$user_cookie" "$png_file" "$private_file" "$answer_file" "$direct_file" "$folder_file" "$large_file" "$archive"' EXIT

  create_test_identity
  admin_email="$TEST_EMAIL"
  api_request POST /api/auth/signup "$(jq -nc --arg u "$TEST_USERNAME" --arg e "$admin_email" \
    '{username:$u,email:$e,password:"test_password_123"}')"
  assert_status 201
  admin_id="$(json_field_or_empty '.id')"
  fetch_verify_token_for_email "$admin_email"
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200
  test_psql auth "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP, role = 'admin' WHERE id = ${admin_id};" >/dev/null
  response="$(curl -sS -c "$admin_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "$admin_email" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "admin login failed: ${response}"; return 1; }

  create_test_identity
  user_email="$TEST_EMAIL"
  api_request POST /api/auth/signup "$(jq -nc --arg u "$TEST_USERNAME" --arg e "$user_email" \
    '{username:$u,email:$e,password:"test_password_123"}')"
  assert_status 201
  user_id="$(json_field_or_empty '.id')"
  fetch_verify_token_for_email "$user_email"
  api_request GET "/api/auth/verify?token=${TEST_VERIFY_TOKEN}"
  assert_status 200
  test_psql auth "UPDATE public.\"user\" SET approved_at = CURRENT_TIMESTAMP WHERE id = ${user_id};" >/dev/null
  response="$(curl -sS -c "$user_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg e "$user_email" '{email:$e,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "user login failed: ${response}"; return 1; }

  # A valid 1x1 PNG. Adding trailing bytes creates another valid image hash.
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' | base64 -d > "$png_file"
  printf '%s' "${API_TEST_RUN_ID}" >> "$png_file"
  cp "$png_file" "$private_file"
  printf 'personal' >> "$private_file"
  cp "$private_file" "$answer_file"
  printf 'solution' >> "$answer_file"
  cp "$png_file" "$direct_file"
  printf 'direct-shared' >> "$direct_file"
  cp "$png_file" "$folder_file"
  printf 'folder-shared' >> "$folder_file"

  response="$(curl -sS -b "$user_cookie" -X POST --data-binary @"$direct_file" \
    -H 'X-Image-Name: denied.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could upload directly to shared media: ${response}"; return 1; }

  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$direct_file" \
    -H "X-Image-Name: api_test_${API_TEST_RUN_ID}_direct.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  direct_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "$direct_id" =~ ^[0-9]+$ ]] \
    || { fail_test "admin direct shared upload failed: ${response}"; return 1; }
  jq -e --argjson id "$direct_id" '.id == $id and .scope == "shared" and .group_id == null' \
    <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "direct shared image was not ungrouped: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$direct_file" \
    -H 'X-Image-Name: duplicate.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "identical shared upload was not reused: ${response}"; return 1; }
  jq -e --argjson id "$direct_id" '.id == $id' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "identical shared upload changed image ID: ${response}"; return 1; }

  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$png_file" \
    -H "X-Image-Name: api_test_${API_TEST_RUN_ID}_shared.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  status="${response##*$'\n'}"
  shared_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "$status" == 201 && "$shared_id" =~ ^[0-9]+$ ]] \
    || { fail_test "admin personal upload failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" "${API_TEST_BASE_URL%/}/api/media/my-images")"
  jq -e --argjson id "$shared_id" --argjson bytes "$(wc -c < "$png_file")" \
    '.usage.count == 1 and any(.images[]; .id == $id and .scope == "personal"
      and .width == 1 and .height == 1 and .size_bytes == $bytes)' <<<"$response" >/dev/null \
    || { fail_test "admin personal upload missing from media list: ${response}"; return 1; }

  response="$(curl -sS -b "$user_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}/publish")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could publish admin image: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}/publish")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "admin publish failed: ${response}"; return 1; }
  jq -e --argjson id "$shared_id" '.id == $id and .scope == "shared"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "published image ID or scope changed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}/publish")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "published image could be published again: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"unauthorized.png"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "non-admin renamed shared image: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"renamed-shared.png"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "admin could not rename shared image: ${response}"; return 1; }
  jq -e '.name == "renamed-shared.png" and .scope == "shared"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "shared image rename returned wrong image: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" "${API_TEST_BASE_URL%/}/api/media/my-images")"
  jq -e --argjson id "$shared_id" '.usage.count == 0 and all(.images[]; .scope == "personal" and .id != $id)' <<<"$response" >/dev/null \
    || { fail_test "shared image remained in admin personal uploads: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/media/my-images")"
  jq -e --argjson id "$shared_id" 'all(.images[]; .id != $id)' <<<"$response" >/dev/null \
    || { fail_test "shared image appears in another user upload list: ${response}"; return 1; }

  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/media/images")"
  jq -e --argjson id "$shared_id" '.usage.count == 0 and .usage.bytes == 0
    and any(.images[]; .id == $id and .scope == "shared")' <<<"$response" >/dev/null \
    || { fail_test "shared image missing or charged to user: ${response}"; return 1; }

  response="$(curl -sS -b "$user_cookie" -X POST --data-binary @"$png_file" \
    -H 'X-Image-Name: copied.png' "${API_TEST_BASE_URL%/}/api/media/images")"
  jq -e --argjson id "$shared_id" '.id == $id and .scope == "shared"' <<<"$response" >/dev/null \
    || { fail_test "identical personal upload did not reuse shared image: ${response}"; return 1; }

  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$private_file" \
    -H 'X-Image-Name: private.png' "${API_TEST_BASE_URL%/}/api/media/images")"
  private_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$private_id" =~ ^[0-9]+$ ]] || { fail_test "personal upload failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$answer_file" \
    -H 'X-Image-Name: answer.png' "${API_TEST_BASE_URL%/}/api/media/images")"
  answer_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$answer_id" =~ ^[0-9]+$ && "$answer_id" != "$private_id" ]] \
    || { fail_test "answer image upload failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"../invalid.png"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "invalid image filename was accepted: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"unauthorized.png"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "another user renamed personal image: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"renamed-private.png"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "owner could not rename personal image: ${response}"; return 1; }
  jq -e '.name == "renamed-private.png" and .scope == "personal"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "personal image rename returned wrong image: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}/publish")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could publish another image: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "another user's image was readable"; return 1; }

  response="$(curl -sS -b "$user_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Not allowed"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/groups")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could create a media group: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg name "api_test_${API_TEST_RUN_ID}_folder" '{name:$name}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/media/groups")"
  group_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "$group_id" =~ ^[0-9]+$ ]] \
    || { fail_test "admin could not create media group: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$group_id" '{group_id:$id}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}/group")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could move shared image: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$group_id" '{group_id:$id}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}/group")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "private image could be grouped: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$group_id" '{group_id:$id}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}/group")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "admin could not group shared image: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/media/groups")"
  jq -e --argjson id "$group_id" '.groups | any(.id == $id and .image_count == 1 and .cover_image_id != null)' <<<"$response" >/dev/null \
    || { fail_test "group not visible to user: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  jq -e --argjson id "$shared_id" --argjson group "$group_id" --argjson bytes "$(wc -c < "$png_file")" \
    '.images | any(.id == $id and .group_id == $group and .width == 1
      and .height == 1 and .size_bytes == $bytes)' <<<"$response" >/dev/null \
    || { fail_test "grouped image not visible to user: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/media/images")"
  jq -e --argjson id "$shared_id" --argjson group "$group_id" '.images | any(.id == $id and .group_id == $group)' <<<"$response" >/dev/null \
    || { fail_test "image library did not include group assignment: ${response}"; return 1; }

  response="$(curl -sS -b "$user_cookie" -X POST --data-binary @"$folder_file" \
    -H 'X-Image-Name: denied.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/groups/${group_id}/images")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "user could upload to shared folder: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$folder_file" \
    -H "X-Image-Name: api_test_${API_TEST_RUN_ID}_folder.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/groups/${group_id}/images")"
  folder_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "$folder_id" =~ ^[0-9]+$ ]] \
    || { fail_test "admin folder upload failed: ${response}"; return 1; }
  jq -e --argjson id "$folder_id" --argjson group "$group_id" \
    '.id == $id and .scope == "shared" and .group_id == $group' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "direct folder upload was not grouped: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$folder_file" \
    -H 'X-Image-Name: wrong-folder.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test "duplicate upload moved shared image: ${response}"; return 1; }

  # This admin did not upload the image but can still organize shared media.
  test_psql auth "UPDATE public.\"user\" SET role = 'admin' WHERE id = ${user_id};" >/dev/null
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg name "api_test_${API_TEST_RUN_ID}_renamed_shared.png" '{name:$name}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second admin could not rename shared image: ${response}"; return 1; }
  jq -e --arg name "api_test_${API_TEST_RUN_ID}_renamed_shared.png" '.name == $name and .scope == "shared"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "second admin image rename returned wrong image: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg name "api_test_${API_TEST_RUN_ID}_renamed" '{name:$name}')" \
    -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/groups/${group_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "second admin could not rename group: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/groups/${group_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "second admin could not delete group: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  jq -e --argjson id "$shared_id" '.images | any(.id == $id and .group_id == null)' <<<"$response" >/dev/null \
    || { fail_test "group deletion did not ungroup image: ${response}"; return 1; }

  response="$(curl -sS -b "$user_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Shared media test"}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  quiz_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$quiz_id" =~ ^[0-9]+$ ]] || { fail_test "quiz creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$private_id" '{template:"no_answer",prompt:"Private?",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "another user's image was accepted: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${shared_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "shared image could be deleted as personal: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Image attempt history"}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  history_quiz_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$history_quiz_id" =~ ^[0-9]+$ ]] || { fail_test "history quiz creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$private_id" '{template:"no_answer",prompt:"Remember this image",config:{image_id:$id}}')" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/questions")"
  history_question_id="$(jq -r '.id // empty' <<<"$response")"
  [[ "$history_question_id" =~ ^[0-9]+$ ]] || { fail_test "history question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$answer_id" '{template:"number",prompt:"The secret number",config:{answer:"42",answer_image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "answer image question creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "private quiz was visible to another user: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/quiz/explore")"
  jq -e --argjson id "$history_quiz_id" '.quizzes | any(.id == $id) | not' <<<"$response" >/dev/null \
    || { fail_test "private quiz appeared in Explore: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Image attempt history","is_public":true}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] && jq -e '.is_public == true' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "quiz could not be published: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/quiz/explore")"
  jq -e --argjson id "$history_quiz_id" '.quizzes | any(.id == $id and .is_public == true)' <<<"$response" >/dev/null \
    || { fail_test "published quiz missing from Explore: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "$response" == 404 ]] || { fail_test "player could load a quiz image before starting: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${answer_id}")"
  [[ "$response" == 404 ]] || { fail_test "player could load an answer image before starting: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Hijacked"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "player could edit a public quiz: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/attempts")"
  public_attempt_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 200 && "$public_attempt_id" =~ ^[0-9]+$ ]] \
    || { fail_test "player could not start a public quiz: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "$response" == 200 ]] || { fail_test "player could not load an image in a reached question: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${answer_id}")"
  [[ "$response" == 404 ]] || { fail_test "player could load an answer image during play: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  jq -e '.play_count == 1' <<<"$response" >/dev/null \
    || { fail_test "player attempt did not count as a play: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Image attempt history","is_public":false}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "quiz could not be made private: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" "${API_TEST_BASE_URL%/}/api/quiz/explore")"
  jq -e --argjson id "$history_quiz_id" '.quizzes | any(.id == $id) | not' <<<"$response" >/dev/null \
    || { fail_test "unpublished quiz remained in Explore: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/attempts/${public_attempt_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "player lost an existing attempt: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/attempts/${public_attempt_id}/complete")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "player could not finish an existing attempt: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${answer_id}")"
  [[ "$response" == 404 ]] || { fail_test "hidden answer image was readable after completion: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Image attempt history","show_correct_answers":true}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not enable answer review: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${answer_id}")"
  [[ "$response" == 200 ]] || { fail_test "permitted answer image was not readable: HTTP ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/attempts")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "player started a new attempt on a private quiz: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X POST -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/attempts")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "image attempt creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}/questions/${history_question_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "history question deletion failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 409 ]] || { fail_test "image used by attempt could be deleted: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${history_quiz_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "history quiz deletion failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "personal image deletion failed: ${response}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${answer_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "answer image deletion failed: ${response}"; return 1; }
  response="$(curl -sS -b "$user_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$shared_id" '{template:"no_answer",prompt:"Shared?",config:{image_id:$id}}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/questions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "shared image was rejected by quiz: ${response}"; return 1; }

  status="$(curl -sS -b "$user_cookie" -o "$archive" -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_id}/export.zip")"
  [[ "$status" == 200 ]] || { fail_test "ZIP export failed: HTTP ${status}"; return 1; }
  manifest="$(php -r '$zip = new ZipArchive(); if ($zip->open($argv[1]) !== true) exit(1); echo $zip->getFromName("quiz.json");' "$archive")"
  jq -e --argjson id "$shared_id" '.images | any(.id == $id)' <<<"$manifest" >/dev/null \
    || { fail_test 'shared image missing from portable ZIP'; return 1; }
  response="$(curl -sS -b "$user_cookie" -H 'Content-Type: application/zip' \
    --data-binary @"$archive" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/import")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "ZIP import failed: ${response}"; return 1; }
  count="$(test_psql media "SELECT count(*) FROM public.image WHERE owner_auth_user_id = ${user_id};")"
  [[ "$count" == 0 ]] || { fail_test "shared ZIP import charged user storage: ${count}"; return 1; }

  cp "$png_file" "$large_file"
  truncate -s 6291456 "$large_file"
  response="$(curl -sS -b "$admin_cookie" --data-binary @"$large_file" \
    -H "X-Image-Name: api_test_${API_TEST_RUN_ID}_large.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  local large_id
  large_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "$large_id" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "6 MiB image upload failed: ${response}"; return 1; }
  jq -e '.size_bytes == 6291456' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "6 MiB image size was not stored: ${response}"; return 1; }
  truncate -s 6291457 "$large_file"
  status="$(curl -sS -b "$admin_cookie" -o /dev/null -w '%{http_code}' --data-binary @"$large_file" \
    -H "X-Image-Name: api_test_${API_TEST_RUN_ID}_too-large.png" \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  [[ "$status" == 413 ]] || { fail_test "image above 6 MiB returned HTTP ${status}"; return 1; }
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${large_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "large image cleanup failed: ${response}"; return 1; }
)

register_test_case test_shared_media_across_users_and_quizzes
