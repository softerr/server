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

  local delete_row_id delete_suggestion_id delete_proposal stale_row_id relation_id related_row_id
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{}' "$base/mdb/databases/$database_id/rows")"
  delete_row_id="$(jq -r '.id' <<<"$response")"
  [[ "$delete_row_id" =~ ^[1-9][0-9]*$ ]] || { fail_test "could not create deletion fixture: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Second row"}' \
    "$base/mdb/databases/$database_id/rows/$delete_row_id/cells/$title_id")"
  [[ "$(jq -r '.value' <<<"$response")" == 'Second row' ]] ||
    { fail_test "could not seed deletion fixture: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $token" \
    "$base/mdb/databases/$database_id/rows/$delete_row_id")" == 403 ]] ||
    { fail_test 'read token deleted a row directly'; return 1; }
  delete_proposal="$(jq -nc --argjson first "$row_id" --argjson second "$delete_row_id" \
    --arg title "$title_id" --arg request 'ac19bc6e-f41a-4f34-a35d-aa0990dac324' \
    '{title:"Remove duplicate rows",request_id:$request,row_deletions:[
      {row_id:$first,before:{($title):"Owner changed it"},reason:"Duplicate one"},
      {row_id:$second,before:{($title):"Second row"},reason:"Duplicate two"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$delete_proposal" -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 201 && "$(jq -r '.change_count' <<<"${response%$'\n'*}")" == 2 ]] ||
    { fail_test "row deletion suggestion failed: $response"; return 1; }
  delete_suggestion_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$delete_proposal" -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 200
    && "$(jq -r '.id' <<<"${response%$'\n'*}")" == "$delete_suggestion_id"
    && "$(jq -r '.change_count' <<<"${response%$'\n'*}")" == 2 ]] ||
    { fail_test "row deletion retry was not idempotent: $response"; return 1; }
  response="$(curl -sS -b "$cookie" \
    "$base/mdb/databases/$database_id/suggestions/$delete_suggestion_id")"
  jq -e '.suggestion.change_count == 2 and (.changes | length) == 2
    and all(.changes[]; .kind == "row_delete" and .fields[0].column == "Title")' \
    <<<"$response" >/dev/null || { fail_test "row deletion review missing: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -X POST -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions/$delete_suggestion_id/accept")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "owner could not accept row deletions: $response"; return 1; }
  [[ "$(test_psql mdb "SELECT count(*) FROM public.database_row
    WHERE id IN ($row_id, $delete_row_id);")" == 0 ]] ||
    { fail_test 'accepted row deletion left rows behind'; return 1; }

  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{}' "$base/mdb/databases/$database_id/rows")"
  stale_row_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Before"}' \
    "$base/mdb/databases/$database_id/rows/$stale_row_id/cells/$title_id")"
  [[ "$(jq -r '.value' <<<"$response")" == 'Before' ]] ||
    { fail_test "could not seed stale row: $response"; return 1; }
  delete_proposal="$(jq -nc --argjson row "$stale_row_id" --arg title "$title_id" \
    '{title:"Delete stale row",row_deletions:[{row_id:$row,before:{($title):"Before"},reason:"Duplicate"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$delete_proposal" "$base/mdb/databases/$database_id/suggestions")"
  delete_suggestion_id="$(jq -r '.id' <<<"$response")"
  [[ "$delete_suggestion_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test "stale row suggestion failed: $response"; return 1; }
  curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"After"}' \
    "$base/mdb/databases/$database_id/rows/$stale_row_id/cells/$title_id" >/dev/null
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$delete_suggestion_id/accept")" == 409 ]] ||
    { fail_test 'stale row deletion was accepted'; return 1; }
  [[ "$(test_psql mdb "SELECT count(*) FROM public.database_row WHERE id = $stale_row_id;")" == 1 ]] ||
    { fail_test 'stale row was deleted'; return 1; }

  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson target "$database_id" --argjson display "$title_id" \
      '{name:"Related",type:"relation",relation_database_id:$target,relation_display_column_id:$display}')" \
    "$base/mdb/databases/$other_id/columns")"
  relation_id="$(jq -r '.id' <<<"$response")"
  response="$(curl -sS -b "$cookie" -H 'Content-Type: application/json' \
    --data '{}' "$base/mdb/databases/$other_id/rows")"
  related_row_id="$(jq -r '.id' <<<"$response")"
  [[ "$relation_id" =~ ^[1-9][0-9]*$ && "$related_row_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test 'could not create referencing row'; return 1; }
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson value "$stale_row_id" '{value:$value}')" \
    "$base/mdb/databases/$other_id/rows/$related_row_id/cells/$relation_id")"
  [[ "$(jq -r '.value' <<<"$response")" == "$stale_row_id" ]] ||
    { fail_test "could not link referencing row: $response"; return 1; }
  delete_proposal="$(jq -nc --argjson row "$stale_row_id" --arg title "$title_id" \
    '{title:"Delete referenced row",row_deletions:[{row_id:$row,before:{($title):"After"},reason:"Duplicate"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$delete_proposal" "$base/mdb/databases/$database_id/suggestions")"
  delete_suggestion_id="$(jq -r '.id' <<<"$response")"
  [[ "$delete_suggestion_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test "referenced row suggestion failed: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$delete_suggestion_id/accept")" == 409 ]] ||
    { fail_test 'referenced row deletion was accepted'; return 1; }
  response="$(curl -sS -b "$cookie" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":null}' \
    "$base/mdb/databases/$other_id/rows/$related_row_id/cells/$relation_id")"
  [[ "$(jq -r '.value' <<<"$response")" == null ]] ||
    { fail_test "could not unlink referencing row: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$delete_suggestion_id/accept")" == 200 ]] ||
    { fail_test 'row deletion stayed blocked after unlinking'; return 1; }
  [[ "$(test_psql mdb "SELECT count(*) FROM public.database_row WHERE id = $stale_row_id;")" == 0 ]] ||
    { fail_test 'unlinked row was not deleted'; return 1; }

  local create_proposal create_suggestion_id row_count_before
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' --data '{}' \
    "$base/mdb/databases/$database_id/rows")" == 403 ]] ||
    { fail_test 'read token created a row directly'; return 1; }
  create_proposal="$(jq -nc --arg title "$title_id" --arg note "$note_id" \
    --arg request 'c8817537-9e3a-4c6c-959a-c17f9567d6cd' \
    '{title:"Add missing movies",request_id:$request,row_creations:[
      {values:{($title):"First movie",($note):"First note"},reason:"Missing movie"},
      {values:{($title):"Second movie"},reason:"Another missing movie"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$create_proposal" -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 201 && "$(jq -r '.change_count' <<<"${response%$'\n'*}")" == 2 ]] ||
    { fail_test "row creation suggestion failed: $response"; return 1; }
  create_suggestion_id="$(jq -r '.id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$create_proposal" -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions")"
  [[ "${response##*$'\n'}" == 200
    && "$(jq -r '.id' <<<"${response%$'\n'*}")" == "$create_suggestion_id"
    && "$(jq -r '.change_count' <<<"${response%$'\n'*}")" == 2 ]] ||
    { fail_test "row creation retry was not idempotent: $response"; return 1; }
  response="$(curl -sS -b "$cookie" \
    "$base/mdb/databases/$database_id/suggestions/$create_suggestion_id")"
  jq -e '.suggestion.change_count == 2 and (.changes | length) == 2
    and .changes[0].kind == "row_create" and .changes[0].item_index == 1
    and .changes[0].fields[0].value == "First movie"
    and .changes[1].fields[0].value == "Second movie"' \
    <<<"$response" >/dev/null || { fail_test "row creation review missing: $response"; return 1; }
  response="$(curl -sS -b "$cookie" -X POST -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/suggestions/$create_suggestion_id/accept")"
  [[ "${response##*$'\n'}" == 200 ]] ||
    { fail_test "owner could not accept row creations: $response"; return 1; }
  [[ "$(test_psql mdb "SELECT COUNT(*) FROM public.database_row r
    JOIN public.database_cell c ON c.row_id = r.id AND c.database_id = r.database_id
    WHERE r.database_id = $database_id AND c.column_id = $title_id
    AND c.value IN ('First movie', 'Second movie');")" == 2 ]] ||
    { fail_test 'accepted row creation did not add both rows'; return 1; }
  [[ "$(test_psql mdb "SELECT COUNT(*) FROM public.database_cell c
    JOIN public.database_row r ON r.id = c.row_id
    WHERE r.database_id = $database_id AND c.column_id = $note_id
    AND c.value = 'First note';")" == 1 ]] ||
    { fail_test 'accepted row creation lost a cell'; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$create_suggestion_id/accept")" == 409 ]] ||
    { fail_test 'accepted row creation could be accepted again'; return 1; }
  create_proposal="$(jq -nc --arg title "$title_id" --arg note "$note_id" \
    '{title:"Stale new rows",row_creations:[
      {values:{($title):"Should not exist"},reason:"Test"},
      {values:{($note):"Should not exist either"},reason:"Test"}]}')"
  response="$(curl -sS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    --data "$create_proposal" "$base/mdb/databases/$database_id/suggestions")"
  create_suggestion_id="$(jq -r '.id' <<<"$response")"
  [[ "$create_suggestion_id" =~ ^[1-9][0-9]*$ ]] ||
    { fail_test "stale row creation suggestion failed: $response"; return 1; }
  row_count_before="$(test_psql mdb "SELECT COUNT(*) FROM public.database_row
    WHERE database_id = $database_id;")"
  response="$(curl -sS -b "$cookie" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Notes renamed"}' -w $'\n%{http_code}' \
    "$base/mdb/databases/$database_id/columns/$note_id")"
  [[ "${response##*$'\n'}" == 200 ]] ||
    { fail_test "could not rename column for stale check: $response"; return 1; }
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" -X POST \
    "$base/mdb/databases/$database_id/suggestions/$create_suggestion_id/accept")" == 409 ]] ||
    { fail_test 'stale row creation was accepted'; return 1; }
  [[ "$(test_psql mdb "SELECT COUNT(*) FROM public.database_cell c
    JOIN public.database_row r ON r.id = c.row_id
    WHERE r.database_id = $database_id AND c.value IN
      ('Should not exist', 'Should not exist either');")" == 0 ]] ||
    { fail_test 'stale row creation partly added rows'; return 1; }
  [[ "$(test_psql mdb "SELECT COUNT(*) FROM public.database_row
    WHERE database_id = $database_id;")" == "$row_count_before" ]] ||
    { fail_test 'stale row creation added blank rows'; return 1; }
)

register_test_case test_mdb_suggestions
