#!/usr/bin/env bash

test_auth_mobile_lifecycle() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'approved account fixture unavailable; skipping mobile lifecycle test'
    return 200
  fi
  local response body access refresh next_access next_refresh headers image_file image_id
  body="$(jq -nc --arg email "${TEST_EMAIL}" \
    '{email:$email,password:"test_password_123",device_name:"API test phone"}')"
  headers="$(mktemp)"
  response="$(curl -sS -D "${headers}" -H 'Content-Type: application/json' --data "${body}" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/login")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.token_type == "Bearer" and .expires_in == 900 and .refresh_expires_in == 2592000
     and (.access_token | startswith("mat_")) and (.refresh_token | startswith("mrt_"))' \
    <<<"${response%$'\n'*}" >/dev/null || grep -qi '^Set-Cookie:' "${headers}"; then
    rm -f "${headers}"
    fail_test "mobile login failed or set a cookie (HTTP ${response##*$'\n'})"
    return 1
  fi
  rm -f "${headers}"
  access="$(jq -r '.access_token' <<<"${response%$'\n'*}")"
  refresh="$(jq -r '.refresh_token' <<<"${response%$'\n'*}")"

  response="$(curl -sS -H "Authorization: Bearer ${access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/me")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg email "${TEST_EMAIL}" \
    '.email == $email and .account_kind == "human"' <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "mobile access token did not identify account: ${response}"
    return 1
  fi
  response="$(curl -sS -X PUT -H "Authorization: Bearer ${access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/me")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.auth_user_id > 0' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "mobile token could not access Musico: ${response}"
    return 1
  fi
  response="$(curl -sS -H "Authorization: Bearer ${access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/users")"
  if [[ "${response##*$'\n'}" != 403 ]]; then
    fail_test "mobile token accessed administrator endpoint: ${response}"
    return 1
  fi

  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg token "${refresh}" '{refresh_token:$token}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/refresh")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg access "${access}" --arg refresh "${refresh}" \
    '.access_token != $access and .refresh_token != $refresh' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "mobile refresh failed (HTTP ${response##*$'\n'})"
    return 1
  fi
  next_access="$(jq -r '.access_token' <<<"${response%$'\n'*}")"
  next_refresh="$(jq -r '.refresh_token' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H "Authorization: Bearer ${access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/me")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test "old mobile access token still works: ${response}"; return 1; }
  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg token "${refresh}" '{refresh_token:$token}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/refresh")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    --arg access "${next_access}" --arg refresh "${next_refresh}" \
    '.access_token == $access and .refresh_token == $refresh
     and .expires_in > 0 and .expires_in <= 900
     and .refresh_expires_in > 0 and .refresh_expires_in <= 2592000' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "lost refresh response could not be recovered (HTTP ${response##*$'\n'})"
    return 1
  fi
  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg token "${next_refresh}" '{refresh_token:$token}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/refresh")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    --arg access "${next_access}" --arg refresh "${next_refresh}" \
    '.access_token != $access and .refresh_token != $refresh' \
    <<<"${response%$'\n'*}" >/dev/null; then
    fail_test "second mobile refresh failed (HTTP ${response##*$'\n'})"
    return 1
  fi
  next_access="$(jq -r '.access_token' <<<"${response%$'\n'*}")"
  next_refresh="$(jq -r '.refresh_token' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg token "${refresh}" '{refresh_token:$token}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/refresh")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test "old mobile refresh token survived a later rotation: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${next_access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "rotated mobile access token failed: ${response}"; return 1; }

  image_file="$(mktemp --suffix=.png)"
  php -r '$image = imagecreatetruecolor(2, 2);
    imagefill($image, 0, 0, imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    imagepng($image, $argv[1]);' "${image_file}"
  response="$(curl -sS -H "Authorization: Bearer ${next_access}" -H 'Content-Type: application/octet-stream' \
    -H "X-Image-Name: mobile-art-${API_TEST_RUN_ID}.png" --data-binary @"${image_file}" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/media/images")"
  image_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || ! "${image_id}" =~ ^[1-9][0-9]*$ ]] \
    || ! jq -e '.scope == "personal"' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${image_file}"
    fail_test "mobile artwork upload failed: ${response}"
    return 1
  fi
  response="$(curl -sS -H "Authorization: Bearer ${next_access}" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${image_id}")"
  [[ "${response}" == 200 ]] || { rm -f "${image_file}"; fail_test "mobile artwork read failed: HTTP ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${next_access}" -H 'Content-Type: application/octet-stream' \
    -H 'X-Image-Name: forbidden.png' --data-binary @"${image_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/shared-images")"
  rm -f "${image_file}"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "mobile token uploaded shared artwork: ${response}"; return 1; }
  response="$(curl -sS -X POST -H "Authorization: Bearer ${next_access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${image_id}/publish")"
  [[ "${response##*$'\n'}" == 403 ]] || { fail_test "mobile token published artwork: ${response}"; return 1; }

  response="$(curl -sS -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg token "${next_refresh}" '{refresh_token:$token}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/mobile/logout")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "mobile logout failed: ${response}"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer ${next_access}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/me")"
  [[ "${response##*$'\n'}" == 401 ]] || { fail_test "mobile access token works after logout: ${response}"; return 1; }
}

register_test_case test_auth_mobile_lifecycle
