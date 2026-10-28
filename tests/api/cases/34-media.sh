#!/usr/bin/env bash

test_shared_media_across_users_and_quizzes() (
  set -e
  # Earlier login cases may have exhausted the per-IP Nginx bucket.
  sudo -n systemctl restart nginx
  local admin_email user_email admin_id user_id admin_cookie user_cookie png_file private_file response status shared_id private_id group_id quiz_id archive manifest count
  admin_cookie="$(mktemp)"
  user_cookie="$(mktemp)"
  png_file="$(mktemp)"
  private_file="$(mktemp)"
  archive="$(mktemp)"
  trap 'rm -f "$admin_cookie" "$user_cookie" "$png_file" "$private_file" "$archive"' EXIT

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
  cp "$png_file" "$private_file"
  printf 'personal' >> "$private_file"

  response="$(curl -sS -b "$admin_cookie" -X POST --data-binary @"$png_file" \
    -H 'X-Image-Name: old-route.png' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  [[ "${response##*$'\n'}" == 405 ]] || { fail_test "direct shared upload route still accepts POST: ${response}"; return 1; }

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

  # This admin did not upload the image but can still organize shared media.
  test_psql auth "UPDATE public.\"user\" SET role = 'admin' WHERE id = ${user_id};" >/dev/null
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
  response="$(curl -sS -b "$admin_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${private_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "personal image deletion failed: ${response}"; return 1; }
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
)

register_test_case test_shared_media_across_users_and_quizzes
