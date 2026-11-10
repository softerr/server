#!/usr/bin/env bash

test_user_api_tokens() (
  set -e
  local owner="api_test_${API_TEST_RUN_ID}_token_owner"
  local other="api_test_${API_TEST_RUN_ID}_token_other"
  local hash owner_id other_id owner_cookie other_cookie audio_file image_file owner_image_file response
  hash="$(php -r 'echo password_hash("test_password_123", PASSWORD_DEFAULT);')"
  owner_id="$(test_psql auth "INSERT INTO public.\"user\" (username, email, password, verified, approved_at)
    VALUES ('${owner}', '${owner}@example.test', '${hash}', TRUE, CURRENT_TIMESTAMP) RETURNING id;")"
  other_id="$(test_psql auth "INSERT INTO public.\"user\" (username, email, password, verified, approved_at)
    VALUES ('${other}', '${other}@example.test', '${hash}', TRUE, CURRENT_TIMESTAMP) RETURNING id;")"
  [[ "${owner_id}" =~ ^[1-9][0-9]*$ && "${other_id}" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test 'could not create token test users'; return 1; }
  owner_cookie="$(mktemp)"
  other_cookie="$(mktemp)"
  audio_file="$(mktemp)"
  image_file="$(mktemp)"
  owner_image_file="$(mktemp)"
  trap 'rm -f "$owner_cookie" "$other_cookie" "$audio_file" "$image_file" "$owner_image_file"' EXIT
  for name in "$owner" "$other"; do
    local cookie="$other_cookie"
    [[ "$name" == "$owner" ]] && cookie="$owner_cookie"
    response="$(curl -sS -c "$cookie" -H 'Content-Type: application/json' \
      --data "$(jq -nc --arg email "${name}@example.test" '{email:$email,password:"test_password_123"}')" \
      -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
    [[ "${response##*$'\n'}" == 200 ]] || { fail_test "token fixture login failed: $response"; return 1; }
  done

  local quiz_a quiz_b db_a db_b playlist_a playlist_b audio_id track_id private_audio_id private_track_id token token_id service_id
  local bot_quiz bot_database bot_playlist
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Granted quiz"}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  quiz_a="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Private quiz"}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  quiz_b="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Granted database"}' "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  db_a="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Private database"}' "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  db_b="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Granted playlist"}' "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  playlist_a="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Private playlist"}' "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  playlist_b="$(jq -r '.id' <<<"$response")"
  [[ "$quiz_a" =~ ^[1-9][0-9]*$ && "$quiz_b" =~ ^[1-9][0-9]*$
    && "$db_a" =~ ^[1-9][0-9]*$ && "$db_b" =~ ^[1-9][0-9]*$
    && "$playlist_a" =~ ^[1-9][0-9]*$ && "$playlist_b" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test 'could not create token resources'; return 1; }

  printf 'RIFF0000WAVEfmt ' >"$audio_file"
  response="$(curl -sS -b "$owner_cookie" -H 'X-Audio-Name: token-test.wav' \
    --data-binary @"$audio_file" "${API_TEST_BASE_URL%/}/api/media/audio")"
  audio_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data "{\"media_audio_id\":${audio_id}}" "${API_TEST_BASE_URL%/}/api/musico/tracks/from-media")"
  track_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'If-Match: "v1"' -H 'Content-Type: application/json' \
    --data "{\"track_id\":${track_id}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_a}/tracks")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "could not add fixture song: $response"; return 1; }
  printf 'RIFF1111WAVEfmt ' >"$audio_file"
  response="$(curl -sS -b "$owner_cookie" -H 'X-Audio-Name: private-token-test.wav' \
    --data-binary @"$audio_file" "${API_TEST_BASE_URL%/}/api/media/audio")"
  private_audio_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data "{\"media_audio_id\":${private_audio_id}}" "${API_TEST_BASE_URL%/}/api/musico/tracks/from-media")"
  private_track_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$owner_cookie" -H 'If-Match: "v1"' -H 'Content-Type: application/json' \
    --data "{\"track_id\":${private_track_id}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_b}/tracks")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "could not add private fixture song: $response"; return 1; }

  response="$(curl -sS -b "$owner_cookie" "${API_TEST_BASE_URL%/}/api/auth/token-capabilities")"
  jq -e --argjson quiz "$quiz_a" --argjson db "$db_a" --argjson playlist "$playlist_a" \
    '(.apps | length) == 3
      and (.apps | any(.id == "quiz" and (.resources | any(.id == $quiz))))
      and (.apps | any(.id == "mdb" and (.resources | any(.id == $db))))
      and (.apps | any(.id == "musico" and (.resources | any(.id == $playlist))))' \
    <<<"$response" >/dev/null || { fail_test "token capabilities incomplete: $response"; return 1; }
  local read_access edit_access
  read_access="$(jq -nc --argjson quiz "$quiz_a" --argjson db "$db_a" --argjson playlist "$playlist_a" \
    '{quiz:{all:"none",resources:[{id:$quiz,permission:"read"}]},
      mdb:{all:"none",resources:[{id:$db,permission:"read"}]},
      musico:{all:"none",resources:[{id:$playlist,permission:"read"}]}}')"
  edit_access="$(jq -nc --argjson quiz "$quiz_a" --argjson db "$db_a" --argjson playlist "$playlist_a" \
    '{quiz:{all:"none",resources:[{id:$quiz,permission:"edit"}]},
      mdb:{all:"none",resources:[{id:$db,permission:"edit"}]},
      musico:{all:"none",resources:[{id:$playlist,permission:"edit"}]}}')"
  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$read_access" \
      '{name:"Automatic scopes",access:$access,expires_in_days:30}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "grant did not add read scopes: $response"; return 1; }
  local auto_token auto_token_id
  auto_token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  auto_token_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $auto_token" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_a}")" == 200 ]] ||
    { fail_test 'automatic quiz read scope did not work'; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$edit_access" '{access:$access}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens/${auto_token_id}/access")"
  [[ "${response##*$'\n'}" == 200 ]] &&
    jq -e '.scopes | index("quiz:write") and index("mdb:write") and index("musico:write")' \
      <<<"${response%$'\n'*}" >/dev/null ||
    { fail_test "grant update did not add write scopes: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $auto_token" \
    -H 'Content-Type: application/json' --data '{}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows")" == 201 ]] ||
    { fail_test 'automatic MDB write scope did not work'; return 1; }
  response="$(curl -sS -b "$other_cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$read_access" \
      '{name:"Wrong owner",scopes:["quiz:read","mdb:read","musico:read"],access:$access,expires_in_days:30}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 400 ]] || { fail_test "foreign resource grant accepted: $response"; return 1; }

  response="$(curl -sS -b "$owner_cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Automation","scopes":["quiz:read","quiz:write","mdb:read","mdb:write","musico:read","musico:write","media:read","media:write"],"expires_in_days":null}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "token creation failed: $response"; return 1; }
  token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  token_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  service_id="$(jq -r '.user_id' <<<"${response%$'\n'*}")"
  [[ "$(test_psql auth "SELECT account_kind = 'service' AND service_owner_id = ${owner_id}
    FROM public.\"user\" WHERE id = ${service_id};")" == t ]] ||
    { fail_test 'token has no separate service account'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/quiz/quizzes/${quiz_a}")" == 404 ]] ||
    { fail_test 'token saw owner quiz without grant'; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  jq -e '.databases == []' <<<"$response" >/dev/null ||
    { fail_test "token saw owner MDB without grant: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data '{"name":"Bot quiz"}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  bot_quiz="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data '{"name":"Bot database"}' "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  bot_database="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data '{"name":"Bot playlist"}' "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  bot_playlist="$(jq -r '.id' <<<"$response")"
  [[ "$bot_quiz" =~ ^[1-9][0-9]*$ && "$bot_database" =~ ^[1-9][0-9]*$
    && "$bot_playlist" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test 'service account could not create its own resources'; return 1; }

  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$read_access" '{access:$access}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "read grant failed: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/quiz/quizzes")"
  jq -e --argjson yes "$quiz_a" --argjson no "$quiz_b" \
    '.quizzes | any(.id == $yes) and all(.id != $no)' <<<"$response" >/dev/null ||
    { fail_test "quiz selection leaked: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  jq -e --argjson yes "$db_a" --argjson no "$db_b" \
    '.databases | any(.id == $yes) and all(.id != $no)' <<<"$response" >/dev/null ||
    { fail_test "MDB selection leaked: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  jq -e --argjson yes "$playlist_a" --argjson no "$playlist_b" \
    '.playlists | any(.id == $yes) and all(.id != $no)' <<<"$response" >/dev/null ||
    { fail_test "Musico selection leaked: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  jq -e --argjson yes "$track_id" --argjson no "$private_track_id" \
    '.tracks | any(.id == $yes) and all(.id != $no)' <<<"$response" >/dev/null ||
    { fail_test "selected playlist songs leaked: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/musico/changes")" == 403 ]] ||
    { fail_test 'selected-playlist token received an incomplete change feed'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/media/audio/${audio_id}")" == 200 ]] ||
    { fail_test 'selected playlist audio missing'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/media/audio/${private_audio_id}")" == 404 ]] ||
    { fail_test 'token read ungranted song audio'; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" "${API_TEST_BASE_URL%/}/api/media/audio")"
  jq -e --argjson yes "$audio_id" --argjson no "$private_audio_id" \
    '.audio | any(.id == $yes) and all(.id != $no)' <<<"$response" >/dev/null ||
    { fail_test "selected playlist audio list leaked: $response"; return 1; }
  for path in "/api/quiz/quizzes/${quiz_b}" "/api/mdb/databases/${db_b}" \
    "/api/musico/playlists/${playlist_b}" "/api/musico/tracks/${private_track_id}"; do
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
      "${API_TEST_BASE_URL%/}${path}")" == 404 ]] ||
      { fail_test "token read ungranted resource: $path"; return 1; }
  done
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data '{}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows")" == 403 ]] ||
    { fail_test 'read grant allowed MDB edit'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH -H "Authorization: Bearer $token" \
    -H 'If-Match: "v1"' -H 'Content-Type: application/json' --data '{"title":"Blocked"}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")" == 403 ]] ||
    { fail_test 'read grant allowed song edit'; return 1; }

  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$edit_access" '{access:$access}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "edit grant failed: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'If-Match: "v2"' -H 'Content-Type: application/json' \
    --data "{\"track_id\":${private_track_id}}" \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_a}/tracks")" == 403 ]] ||
    { fail_test 'token imported a song from an ungranted playlist'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data '{}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows")" == 201 ]] ||
    { fail_test 'selected MDB edit failed'; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer $token" -H 'If-Match: "v1"' \
    -H 'Content-Type: application/json' --data '{"title":"Edited by token","artist":"","album":"","genre":""}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "selected song edit failed: $response"; return 1; }
  response="$(curl -sS -X PATCH -H "Authorization: Bearer $token" -H 'If-Match: "v2"' \
    -H 'Content-Type: application/json' --data '{"name":"Edited playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_a}")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "selected playlist edit failed: $response"; return 1; }
  php -r '$im=imagecreatetruecolor(1,1); imagepng($im,$argv[1]); imagedestroy($im);' "$image_file"
  php -r '$im=imagecreatetruecolor(1,1); $red=imagecolorallocate($im,255,0,0); imagefill($im,0,0,$red); imagepng($im,$argv[1]); imagedestroy($im);' "$owner_image_file"
  response="$(curl -sS -b "$owner_cookie" -H 'X-Image-Name: private-owner.png' \
    --data-binary @"$owner_image_file" "${API_TEST_BASE_URL%/}/api/media/images")"
  local owner_image_id uploaded_image_id image_column_id image_row_id
  owner_image_id="$(jq -r '.id' <<<"$response")"
  [[ "$owner_image_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test "owner image fixture failed: $response"; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'X-Image-Name: token-mdb.png' \
    --data-binary @"$image_file" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images?for=mdb&resource_id=${db_a}")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "selected MDB image upload failed: $response"; return 1; }
  uploaded_image_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/media/images/${uploaded_image_id}")" == 200 ]] ||
    { fail_test 'token could not read its uploaded image'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/media/images/${owner_image_id}")" == 404 ]] ||
    { fail_test 'token read unrelated owner image'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'X-Image-Name: token-mdb.png' --data-binary @"$image_file" \
    "${API_TEST_BASE_URL%/}/api/media/images?for=mdb&resource_id=${db_b}")" == 403 ]] ||
    { fail_test 'ungranted MDB image upload accepted'; return 1; }
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data '{"name":"Image","type":"image"}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/columns")"
  image_column_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data '{}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows")"
  image_row_id="$(jq -r '.id' <<<"$response")"
  [[ "$image_column_id" =~ ^[1-9][0-9]*$ && "$image_row_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test 'token could not create MDB image cell'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data "{\"value\":${owner_image_id}}" \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows/${image_row_id}/cells/${image_column_id}")" == 403 ]] ||
    { fail_test 'token attached unrelated owner image'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data "{\"value\":${uploaded_image_id}}" \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${db_a}/rows/${image_row_id}/cells/${image_column_id}")" == 200 ]] ||
    { fail_test 'token could not attach its uploaded image'; return 1; }
  response="$(curl -sS -b "$other_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson access "$read_access" '{access:$access}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/access")"
  [[ "${response##*$'\n'}" == 404 ]] || { fail_test "other owner changed grant: $response"; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"access":{"quiz":{"all":"read","resources":[]},"mdb":{"all":"read","resources":[]},"musico":{"all":"read","resources":[]}}}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "all-resource grant failed: $response"; return 1; }
  for path in "/api/quiz/quizzes/${bot_quiz}" "/api/mdb/databases/${bot_database}" \
    "/api/musico/playlists/${bot_playlist}" "/api/quiz/quizzes/${quiz_b}" \
    "/api/mdb/databases/${db_b}" "/api/musico/playlists/${playlist_b}"; do
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
      "${API_TEST_BASE_URL%/}${path}")" == 200 ]] ||
      { fail_test "all-resource grant did not expose $path"; return 1; }
  done
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/musico/changes")" == 200 ]] ||
    { fail_test 'all-playlist token could not read change feed'; return 1; }
  response="$(curl -sS -b "$owner_cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"access":{}}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}/access")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "grant revocation failed: $response"; return 1; }
  for path in "/api/quiz/quizzes/${quiz_a}" "/api/mdb/databases/${db_a}" \
    "/api/musico/playlists/${playlist_a}" "/api/musico/tracks/${track_id}" \
    "/api/media/audio/${audio_id}" "/api/media/images/${uploaded_image_id}"; do
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
      "${API_TEST_BASE_URL%/}${path}")" == 404 ]] ||
      { fail_test "revoked grant still exposed $path"; return 1; }
  done
  for path in "/api/quiz/quizzes/${bot_quiz}" "/api/mdb/databases/${bot_database}" \
    "/api/musico/playlists/${bot_playlist}"; do
    [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
      "${API_TEST_BASE_URL%/}${path}")" == 200 ]] ||
      { fail_test "grant revocation hid service-account resource $path"; return 1; }
  done
  response="$(curl -sS -b "$owner_cookie" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/auth/tokens/${token_id}")"
  [[ "${response##*$'\n'}" == 204 ]] || { fail_test "token revoke failed: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "${API_TEST_BASE_URL%/}/api/auth/me")" == 401 ]] ||
    { fail_test 'revoked token still works'; return 1; }
)

register_test_case test_user_api_tokens
