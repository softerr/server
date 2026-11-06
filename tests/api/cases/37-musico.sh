#!/usr/bin/env bash

test_musico_shared_track_playlists() {
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'login fixture unavailable; skipping Musico test'
    return 200
  fi
  local cookie_file audio_file response track_id media_audio_id first_id second_id range_status range_body content_hash upload_key listen_key restore_key playlist_key second_playlist_key initial_cursor first_change_cursor snapshot_cursor delete_cursor track_version stats_version stale_version first_version second_version
  cookie_file="$(mktemp)"
  audio_file="$(mktemp --suffix=.wav)"
  php -r '
    $samples = str_repeat("\0", 8000);
    echo "RIFF", pack("V", 36 + strlen($samples)), "WAVEfmt ",
      pack("VvvVVvv", 16, 1, 1, 8000, 8000, 1, 8),
      "data", pack("V", strlen($samples)), $samples;
  ' > "${audio_file}"
  upload_key='550e8400-e29b-41d4-a716-446655440000'
  listen_key='550e8400-e29b-41d4-a716-446655440001'
  restore_key='550e8400-e29b-41d4-a716-446655440002'
  playlist_key='550e8400-e29b-41d4-a716-446655440004'
  second_playlist_key='550e8400-e29b-41d4-a716-446655440005'

  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  if [[ "${response##*$'\n'}" != 200 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico login failed: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes")"
  initial_cursor="$(jq -r '.cursor // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || "${initial_cursor}" != 0 ]] \
    || ! jq -e '.tracks == [] and .playlists == []' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico initial change snapshot failed: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -H "Idempotency-Key: ${upload_key}" \
    -F "file=@${audio_file};filename=shared.wav" \
    -F 'album=Uploaded album' -F 'genre=Rock' -F 'year=2025' -F 'track_number=3' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  track_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  media_audio_id="$(jq -r '.media_audio_id // empty' <<<"${response%$'\n'*}")"
  track_version="$(jq -r '.version // empty' <<<"${response%$'\n'*}")"
  stats_version="$(jq -r '.stats_version // empty' <<<"${response%$'\n'*}")"
  content_hash="$(sha256sum "${audio_file}" | cut -d ' ' -f 1)"
  if [[ "${response##*$'\n'}" != 201 || ! "${track_id}" =~ ^[1-9][0-9]*$ \
    || ! "${media_audio_id}" =~ ^[1-9][0-9]*$ \
    || "${track_version}" != 1 || "${stats_version}" != 1 ]] \
    || ! jq -e --arg hash "${content_hash}" '.content_sha256 == $hash and .album == "Uploaded album" and .genre == "Rock" and .year == 2025 and .track_number == 3 and .analysis == null' \
      <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico upload failed: ${response}"
    return 1
  fi

  if [[ "$(test_psql musico "SELECT media_audio_id FROM public.track WHERE id = ${track_id}")" != "${media_audio_id}" \
    || "$(test_psql musico "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'track' AND column_name IN ('content', 'original_name', 'mime_type', 'size_bytes', 'content_sha256')")" != 0 \
    || "$(test_psql media "SELECT sha256 FROM public.audio_file WHERE id = ${media_audio_id} AND octet_length(content) = size_bytes")" != "${content_hash}" ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test 'Musico track did not reference audio bytes in Media'
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/audio/${media_audio_id}")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Media deleted an audio file still used by Musico: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/audio")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${media_audio_id}" \
    --argjson track "${track_id}" \
    '.audio | any(.id == $id and (.musico_song_ids | index($track) != null))' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Media audio list did not include uploaded song: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -H "Idempotency-Key: ${upload_key}" \
    -F "file=@${audio_file};filename=shared.wav" \
    -F 'album=Uploaded album' -F 'genre=Rock' -F 'year=2025' -F 'track_number=3' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    '.id == $id' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico upload retry did not return the original track: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -H "Idempotency-Key: ${upload_key}" \
    -F "file=@${audio_file};filename=shared.wav" -F 'title=Different request' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico reused an upload key for different metadata: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -F "file=@${audio_file};filename=retry.wav" \
    -F 'title=Retry must not overwrite metadata' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    --arg hash "${content_hash}" '.id == $id and .content_sha256 == $hash and .title != "Retry must not overwrite metadata"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico duplicate upload did not return the original track: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${initial_cursor}&limit=1")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    '.has_more == false and (.changes | length) == 1
     and .changes[0].resource == "track" and .changes[0].id == $id
     and .changes[0].action == "upsert" and .next_cursor == .changes[0].cursor' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico upload change feed failed: ${response}"
    return 1
  fi
  first_change_cursor="$(jq -r '.next_cursor' <<<"${response%$'\n'*}")"
  if [[ ! "${first_change_cursor}" =~ ^[1-9][0-9]*\.[0-9a-f]{8}-[0-9a-f-]{27}$ ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico change cursor is not opaque: ${first_change_cursor}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${first_change_cursor%%.*}.00000000-0000-0000-0000-000000000000")"
  if [[ "${response##*$'\n'}" != 409 ]] || ! jq -e '.reset_required == true' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico reused a restored change ID without detecting a new marker: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=$(( ${first_change_cursor%%.*} + 1000000 )).${first_change_cursor#*.}")"
  if [[ "${response##*$'\n'}" != 409 ]] || ! jq -e '.reset_required == true' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico accepted a cursor ahead of restored history: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    '.id == $id' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico track detail failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=invalid")"
  if [[ "${response}" != 400 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico accepted an invalid change cursor: HTTP ${response}"
    return 1
  fi

  local analysis_json
  analysis_json='{"duration_ms":1000,"bit_rate":64000,"sample_rate_hz":8000,"bit_depth":8,"channels":1,"codec":"PCM","estimated_bpm":120,"estimated_key":"C major","peak_db":-1.5,"average_db":-12.25,"dynamic_range_db":10.75}'
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "${analysis_json}" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/analysis")"
  if [[ "${response}" != 428 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico accepted an analysis edit without If-Match: HTTP ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    -H "If-Match: \"v${track_version}\"" \
    --data "${analysis_json}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/analysis")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.version == 2 and .analysis.duration_ms == 1000 and .analysis.estimated_bpm == 120
     and .analysis.estimated_key == "C major" and .analysis.dynamic_range_db == 10.75' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico analysis save failed: ${response}"
    return 1
  fi
  track_version="$(jq -r '.version' <<<"${response%$'\n'*}")"
  local stored_analysis
  stored_analysis="$(test_psql musico "SELECT duration_ms = 1000 AND bit_rate = 64000
      AND sample_rate_hz = 8000 AND bit_depth = 8 AND channels = 1 AND codec = 'PCM'
      AND estimated_bpm = 120 AND estimated_key = 'C major' AND peak_db = -1.5
      AND average_db = -12.25 AND dynamic_range_db = 10.75
      AND analysis_saved_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'track' AND column_name = 'analysis')
      FROM public.track WHERE id = ${track_id};")" || stored_analysis=''
  if [[ "${stored_analysis}" != t ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico analysis was not stored in separate columns: ${stored_analysis}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    -H "If-Match: \"v${track_version}\"" \
    --data "${analysis_json/\"estimated_bpm\":120/\"estimated_bpm\":\"fast\"}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/analysis")"
  if [[ "${response##*$'\n'}" != 400 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico accepted invalid analysis: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" --arg hash "${content_hash}" \
    --argjson size "$(wc -c < "${audio_file}")" \
    '(.tracks | any(.id == $id and .analysis.estimated_bpm == 120))
     and ([.tracks[] | select(.content_sha256 == $hash)] | length) == 1
     and .usage.bytes >= $size and .usage.bytes <= .limits.bytes
     and .limits.bytes == 4294967296
     and .limits.per_file_bytes >= $size' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico storage usage was not reported: ${response}"
    return 1
  fi

  stale_version="${track_version}"
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    -H "If-Match: \"v${track_version}\"" \
    --data '{"title":"Edited song","artist":"Test artist","album":"Test album","genre":"Rock","year":2024,"track_number":2,"rating":8}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.version == 3 and .title == "Edited song" and .album == "Test album" and .rating == 8 and .year == 2024
     and .analysis.estimated_key == "C major"' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico metadata edit failed: ${response}"
    return 1
  fi
  track_version="$(jq -r '.version' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    -H "If-Match: \"v${stale_version}\"" \
    --data '{"title":"Stale edit","artist":"","album":"","genre":""}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response##*$'\n'}" != 412 ]] || ! jq -e --argjson version "${track_version}" \
    '.current_version == $version' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico stale track edit was not rejected: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"started":true,"milliseconds":5000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/listen")"
  if [[ "${response##*$'\n'}" != 428 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico listen accepted a missing idempotency key: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'X-Audio-Name: shared.wav' \
    -H 'Content-Type: application/octet-stream' --data-binary @"${audio_file}" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/media/audio")"
  if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e --argjson id "${media_audio_id}" \
    '.id == $id' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Media audio upload did not reuse the file: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${listen_key}" \
    --data '{"started":true,"milliseconds":5000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/listen")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.play_count == 1 and .listen_ms == 5000 and .stats_version == 2' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico listening stats failed: ${response}"
    return 1
  fi
  stats_version="$(jq -r '.stats_version' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${listen_key}" \
    --data '{"started":true,"milliseconds":5000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/listen")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.play_count == 1 and .listen_ms == 5000 and .stats_version == 2' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico listen retry changed statistics: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${listen_key}" \
    --data '{"milliseconds":1000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/listen")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico reused a statistic key for another listen: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.play_count == 1 and .listen_ms == 5000 and .stats_version == 2' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico statistic retry changed stored totals: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440003' \
    -H 'If-Match: "s1"' --data '{"play_count":4,"listen_ms":9000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/restore-stats")"
  if [[ "${response##*$'\n'}" != 412 ]] || ! jq -e --argjson version "${stats_version}" \
    '.current_version == $version' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico stale statistics restore was not rejected: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${restore_key}" -H "If-Match: \"s${stats_version}\"" \
    --data '{"play_count":4,"listen_ms":9000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/restore-stats")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.play_count == 4 and .listen_ms == 9000 and .stats_version == 3' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico statistics restore failed: ${response}"
    return 1
  fi
  stats_version="$(jq -r '.stats_version' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${restore_key}" -H 'If-Match: "s2"' \
    --data '{"play_count":4,"listen_ms":9000}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/restore-stats")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.play_count == 4 and .listen_ms == 9000 and .stats_version == 3' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico statistics restore retry was not replayed: ${response}"
    return 1
  fi

  local art_file art_id
  art_file="$(mktemp --suffix=.png)"
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' \
    | base64 -d > "${art_file}"
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/octet-stream' \
    -H 'X-Image-Name: musico-art.png' --data-binary @"${art_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  art_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  rm -f "${art_file}"
  if [[ "${response##*$'\n'}" != 201 || ! "${art_id}" =~ ^[1-9][0-9]*$ ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico artwork upload failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    -H "If-Match: \"v${track_version}\"" \
    --data "{\"title\":\"Edited song\",\"artist\":\"Test artist\",\"album\":\"Test album\",\"genre\":\"Rock\",\"art_image_id\":${art_id}}" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${art_id}" \
    '.art_image_id == $id and .version == 4' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico artwork selection failed: ${response}"
    return 1
  fi
  track_version="$(jq -r '.version' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "{\"image_ids\":[${art_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/usage")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    '.images[0].uses | any(.kind == "musico_track" and .track_id == $id)' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico artwork usage was not reported: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${art_id}")"
  if [[ "${response}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Used Musico artwork was deleted without force: HTTP ${response}"
    return 1
  fi
  curl -fsS -b "${cookie_file}" -X DELETE \
    "${API_TEST_BASE_URL%/}/api/media/images/${art_id}?force=1" >/dev/null

  range_body="$(mktemp)"
  range_status="$(curl -sS -b "${cookie_file}" -H 'Range: bytes=0-3' \
    -o "${range_body}" -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}/file")"
  if [[ "${range_status}" != 206 || "$(cat "${range_body}")" != RIFF ]]; then
    rm -f "${cookie_file}" "${audio_file}" "${range_body}"
    fail_test "Musico range playback failed: HTTP ${range_status}"
    return 1
  fi
  rm -f "${range_body}"

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${playlist_key}" \
    --data '{"name":"First playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  first_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  first_version="$(jq -r '.version // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || ! "${first_id}" =~ ^[1-9][0-9]*$ || "${first_version}" != 1 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "First playlist creation failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${playlist_key}" \
    --data '{"name":"First playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${first_id}" \
    '.id == $id and .name == "First playlist" and .version == 1' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico playlist creation retry did not return the original playlist: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${playlist_key}" \
    --data '{"name":"Another playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico reused a playlist creation key for a different name: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${second_playlist_key}" \
    --data '{"name":"Second playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  second_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  second_version="$(jq -r '.version // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 201 || ! "${second_id}" =~ ^[1-9][0-9]*$ || "${second_version}" != 1 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Second playlist creation failed: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    -H "If-Match: \"v${second_version}\"" \
    --data '{"name":"Renamed playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${second_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.name == "Renamed playlist" and .version == 2' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Playlist rename failed: ${response}"
    return 1
  fi
  second_version="$(jq -r '.version' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${second_playlist_key}" \
    --data '{"name":"Second playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${second_id}" \
    '.id == $id and .name == "Renamed playlist" and .version == 2' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico playlist creation retry after rename failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    -H 'If-Match: "v1"' --data '{"name":"Stale playlist rename"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${second_id}")"
  if [[ "${response##*$'\n'}" != 412 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico stale playlist rename was not rejected: ${response}"
    return 1
  fi

  local playlist_id
  for playlist_id in "${first_id}" "${second_id}"; do
    local current_version
    current_version="${first_version}"
    if [[ "${playlist_id}" == "${second_id}" ]]; then current_version="${second_version}"; fi
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      -H "If-Match: \"v${current_version}\"" \
      --data "{\"track_id\":${track_id}}" -w $'\n%{http_code}' \
      "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_id}/tracks")"
    if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e --argjson version "$((current_version + 1))" \
      '.version == $version' <<<"${response%$'\n'*}" >/dev/null; then
      rm -f "${cookie_file}" "${audio_file}"
      fail_test "Could not add shared track to playlist ${playlist_id}: ${response}"
      return 1
    fi
    if [[ "${playlist_id}" == "${first_id}" ]]; then first_version="$((first_version + 1))";
    else second_version="$((second_version + 1))"; fi
  done

  response="$(curl -sS -b "${cookie_file}" -X DELETE -H "If-Match: \"v${first_version}\"" -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${first_id}/tracks/${track_id}")"
  if [[ "${response}" != 204 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Could not remove track from first playlist: ${response}"
    return 1
  fi
  first_version="$((first_version + 1))"
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${second_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${track_id}" \
    '.tracks | any(.id == $id and .analysis.estimated_bpm == 120)' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Second playlist lost the shared track: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes")"
  snapshot_cursor="$(jq -r '.cursor // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || ! "${snapshot_cursor}" =~ ^[1-9][0-9]*\.[0-9a-f]{8}-[0-9a-f-]{27}$ ]] \
    || ! jq -e --argjson id "${track_id}" --argjson first "${first_id}" --argjson second "${second_id}" \
    '(.tracks | any(.id == $id)) and (.playlists | length) == 2
     and (.playlists | any(.id == $first and .track_ids == []))
     and (.playlists | any(.id == $second and .track_ids == [$id]))' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico change snapshot lost playlist membership: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${initial_cursor}&limit=200")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --arg cursor "${snapshot_cursor}" \
    '.has_more == false and .next_cursor == $cursor
     and ([.changes[] | select(.resource == "track" and .action == "upsert")] | length) == 6
     and ([.changes[] | select(.resource == "playlist" and .action == "upsert")] | length) == 6' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico change feed missed a track or playlist write: ${response}"
    return 1
  fi

  response="$(curl -sS -b "${cookie_file}" -X DELETE -H "If-Match: \"v${track_version}\"" -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response}" != 204 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Could not delete Musico track: ${response}"
    return 1
  fi
  second_version="$((second_version + 1))"
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${snapshot_cursor}&limit=1")"
  delete_cursor="$(jq -r '.next_cursor // empty' <<<"${response%$'\n'*}")"
  if [[ "${response##*$'\n'}" != 200 || ! "${delete_cursor}" =~ ^[1-9][0-9]*\.[0-9a-f]{8}-[0-9a-f-]{27}$ ]] \
    || ! jq -e --argjson id "${track_id}" \
    '.has_more == true and (.changes | length) == 1
     and .changes[0].resource == "track" and .changes[0].id == $id
     and .changes[0].action == "delete"' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico track deletion tombstone failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${delete_cursor}&limit=1")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e --argjson id "${second_id}" \
    '.has_more == false and (.changes | length) == 1
     and .changes[0].resource == "playlist" and .changes[0].id == $id
     and .changes[0].action == "upsert"' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico playlist cascade change was not paged: ${response}"
    return 1
  fi
  delete_cursor="$(jq -r '.next_cursor' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response}" != 404 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Deleted Musico track detail did not return 404: HTTP ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H "Idempotency-Key: ${upload_key}" \
    -F "file=@${audio_file};filename=shared.wav" \
    -F 'album=Uploaded album' -F 'genre=Rock' -F 'year=2025' -F 'track_number=3' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/musico/tracks")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico recreated a deleted track on upload retry: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists/${second_id}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e '.tracks | length == 0' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Deleted track remains in second playlist: ${response}"
    return 1
  fi
  for playlist_id in "${first_id}" "${second_id}"; do
    local current_version
    current_version="${first_version}"
    if [[ "${playlist_id}" == "${second_id}" ]]; then current_version="${second_version}"; fi
    curl -sS -b "${cookie_file}" -X DELETE -H "If-Match: \"v${current_version}\"" \
      "${API_TEST_BASE_URL%/}/api/musico/playlists/${playlist_id}" >/dev/null
  done
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${playlist_key}" \
    --data '{"name":"First playlist"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/playlists")"
  if [[ "${response##*$'\n'}" != 409 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico recreated a deleted playlist on creation retry: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/changes?after=${delete_cursor}")"
  if [[ "${response##*$'\n'}" != 200 ]] || ! jq -e \
    '.has_more == false and (.changes | length) == 2
     and all(.changes[]; .resource == "playlist" and .action == "delete")' \
    <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Musico playlist deletion tombstones failed: ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "{\"media_audio_id\":${media_audio_id}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/from-media")"
  if [[ "${response##*$'\n'}" != 201 ]] || ! jq -e --argjson id "${media_audio_id}" \
    '.media_audio_id == $id' <<<"${response%$'\n'*}" >/dev/null; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Could not add Media audio to Musico: ${response}"
    return 1
  fi
  track_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X DELETE -H 'If-Match: "v1"' -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/musico/tracks/${track_id}")"
  if [[ "${response}" != 204 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Could not delete Media-backed song: HTTP ${response}"
    return 1
  fi
  response="$(curl -sS -b "${cookie_file}" -X DELETE -o /dev/null -w '%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/audio/${media_audio_id}")"
  if [[ "${response}" != 204 ]]; then
    rm -f "${cookie_file}" "${audio_file}"
    fail_test "Could not delete unreferenced Media audio: HTTP ${response}"
    return 1
  fi
  rm -f "${cookie_file}" "${audio_file}"
}

register_test_case test_musico_shared_track_playlists
