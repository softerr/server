#!/usr/bin/env bash

test_mdb_suggestions() (
  set -e
  local cookie base response database_id other_id title_id note_id row_id token token_id suggestion_id
  local username email hash owner_id
  local request_id='a4124391-ade9-4f0f-b49d-80c00b6139ee'
  username="api_test_${API_TEST_RUN_ID}_suggestion_owner"
  email="${username}@example.test"
  hash="$(php -r 'echo password_hash("test_password_123", PASSWORD_DEFAULT);')"
  owner_id="$(test_psql auth "INSERT INTO public.\"user\"
    (username, email, password, verified, approved_at)
    VALUES ('${username}', '${email}', '${hash}', TRUE, CURRENT_TIMESTAMP) RETURNING id;")"
  [[ "$owner_id" =~ ^[1-9][0-9]*$ ]] || { fail_test 'could not create suggestion user'; return 1; }
  cookie="$(mktemp)"
  trap 'rm -f -- "$cookie"' EXIT
  base="${API_TEST_BASE_URL%/}/api"
  response="$(curl -sS -c "$cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "$email" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "$base/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "suggestion fixture login failed: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Suggestion test"}' "$base/mdb/databases")"
  database_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Other suggestion test"}' "$base/mdb/databases")"
  other_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Title"}' "$base/mdb/databases/$database_id/columns")"
  title_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{"name":"Notes"}' "$base/mdb/databases/$database_id/columns")"
  note_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{}' "$base/mdb/databases/$database_id/rows")"
  row_id="$(jq -r '.id' <<<"$response")"
  for id in "$database_id" "$other_id" "$title_id" "$note_id" "$row_id"; do
    [[ "$id" =~ ^[1-9][0-9]*$ ]] || { fail_test 'could not create suggestion fixture'; return 1; }
  done
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Old title"}' -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/rows/$row_id/cells/$title_id")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "could not seed cell: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson id "$database_id" \
      '{name:"Suggestion token",access:{mdb:{all:"none",resources:[{id:$id,permission:"read"}]}},expires_in_days:30}')" \
    -w $'\n%{http_code}' "$base/auth/tokens")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "could not create read token: $response"; return 1; }
  token="$(jq -r '.token' <<<"${response%$'\n'*}")"
  token_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  [[ "$token_id" =~ ^[1-9][0-9]*$ ]] || { fail_test 'token ID missing'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data '{"value":"Direct write"}' \
    "$base/mdb/databases/$database_id/rows/$row_id/cells/$title_id")" == 403 ]] ||
    { fail_test 'read token changed a cell directly'; return 1; }
  local proposal
  proposal="$(jq -nc --argjson row "$row_id" --argjson title "$title_id" \
    --arg request "$request_id" \
    '{title:"Fix title",request_id:$request,changes:[{row_id:$row,column_id:$title,
      before:"Old title",value:"New title",reason:"Corrected title"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$proposal" -w $'\n%{http_code}' "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "read token could not suggest: $response"; return 1; }
  suggestion_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$proposal" -w $'\n%{http_code}' "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 200 && "$(jq -r '.id' <<<"${response%$'\n'*}")" == "$suggestion_id" ]] ||
    { fail_test "suggestion retry was not idempotent: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data "$(jq -c '.changes[0].value = "Different title"' <<<"$proposal")" \
    "$base/mdb/databases/$database_id/suggestions")" == 409 ]] ||
    { fail_test 'reused request ID changed a suggestion'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    "$base/mdb/databases/$database_id/suggestions")" == 403 ]] ||
    { fail_test 'token accessed owner review list'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data "$proposal" \
    "$base/mdb/databases/$other_id/suggestions")" == 403 ]] ||
    { fail_test 'token suggested in ungranted database'; return 1; }
  response="$(curl -sS -b "$cookie" "$base/mdb/databases/$database_id/suggestions/$suggestion_id")"
  jq -e '.suggestion.status == "pending" and .changes[0].row_position == 1
    and .changes[0].row_label == "Old title" and .changes[0].before == "Old title"
    and .changes[0].value == "New title" and .changes[0].reason == "Corrected title"' \
    <<<"$response" >/dev/null || { fail_test "suggestion diff missing: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$suggestion_id/accept")" == 403 ]] ||
    { fail_test 'token accepted its own suggestion'; return 1; }
  response="$(curl -sS -b "$cookie" -X POST -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions/$suggestion_id/accept")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "owner could not accept: $response"; return 1; }
  [[ "$(test_psql mdb "SELECT value FROM public.database_cell
    WHERE row_id = $row_id AND column_id = $title_id;")" == 'New title' ]] ||
    { fail_test 'accepted suggestion did not update cell'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$suggestion_id/accept")" == 409 ]] ||
    { fail_test 'accepted suggestion could be accepted again'; return 1; }
  local second
  second="$(jq -nc --argjson row "$row_id" --argjson title "$title_id" --argjson note "$note_id" \
    '{title:"Two cells",changes:[{row_id:$row,column_id:$title,before:"New title",value:"Suggested title",reason:"Title"},
      {row_id:$row,column_id:$note,before:null,value:"Suggested note",reason:"Note"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$second" "$base/mdb/databases/$database_id/suggestions")"
  suggestion_id="$(jq -r '.id' <<<"$response")"
  [[ "$suggestion_id" =~ ^[1-9][0-9]*$ ]] || { fail_test "batch suggestion failed: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Owner changed it"}' "$base/mdb/databases/$database_id/rows/$row_id/cells/$title_id")"
  [[ "$(jq -r '.value' <<<"$response")" == 'Owner changed it' ]] ||
    { fail_test "could not make suggestion stale: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$suggestion_id/accept")" == 409 ]] ||
    { fail_test 'stale suggestion was accepted'; return 1; }
  [[ "$(test_psql mdb "SELECT count(*) FROM public.database_cell
    WHERE row_id = $row_id AND column_id = $note_id;")" == 0 ]] ||
    { fail_test 'stale batch partly changed cells'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$suggestion_id/decline")" == 200 ]] ||
    { fail_test 'owner could not decline stale suggestion'; return 1; }
)

register_test_case test_mdb_suggestions
