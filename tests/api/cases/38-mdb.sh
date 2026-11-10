#!/usr/bin/env bash

test_mdb_database_library() (
  api_request GET /api/mdb/databases
  assert_status 401 || return 1
  api_request POST /api/mdb/databases '{"name":"Guest database"}'
  assert_status 401 || return 1
  api_request PUT /api/mdb/databases/1/columns/order '{"ids":[]}'
  assert_status 401 || return 1
  api_request DELETE /api/mdb/databases/1/rows/1
  assert_status 401 || return 1
  api_request GET /api/mdb/databases/1/rows/1/usage
  assert_status 401 || return 1
  api_request DELETE /api/mdb/databases/1/columns/1
  assert_status 401 || return 1

  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'login fixture unavailable; skipping MDB test'
    return 200
  fi
  local cookie_file response database_id auth_id count column_id row_id other_id related_row_id second_related_row_id
  local related_name_column_id related_code_column_id
  local type spec typed_id json_value second_row_id column_order row_order display_name
  local -A typed_ids
  cookie_file="$(mktemp)"
  trap 'rm -f -- "${cookie_file}"' EXIT
  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "MDB fixture login failed: ${response}"; return 1; }
  auth_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.databases == []' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB library was not empty: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"  Personal records  "}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  database_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${database_id}" =~ ^[1-9][0-9]*$ ]] \
    && jq -e '.name == "Personal records" and (.created | type == "string")' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB creation failed: ${response}"; return 1; }
  count="$(test_psql mdb "SELECT count(*) FROM public.user_database d
    JOIN public.\"user\" u ON u.id = d.user_id
    WHERE d.id = ${database_id} AND u.auth_user_id = ${auth_id};")"
  [[ "${count}" == 1 ]] || { fail_test 'MDB database was not linked to its auth user'; return 1; }

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns == [] and .rows == []' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB editor did not open an empty table: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Title"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns")"
  column_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${column_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not add a column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"width":320}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${column_id}/width")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.width == 320' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not resize a column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns[0].width == 320' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB column width was not saved: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"width":95}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${column_id}/width")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an invalid column width: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows")"
  row_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${row_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not add a row: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"First entry"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not save a cell: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Notes"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns")"
  [[ "${response##*$'\n'}" == 201 ]] \
    || { fail_test "MDB could not add a second column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"notes"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${column_id}")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB accepted a duplicate column name: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Heading"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.name == "Heading"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not rename a column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg id "${column_id}" \
      '.columns[0].name == "Heading" and .rows[0].values[$id] == "First entry"' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB did not return saved table data: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Another table"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  other_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${other_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not create a second database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows")"
  related_row_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${related_row_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not create a related row: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows")"
  second_related_row_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${second_related_row_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not create a second related row: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Name"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/columns")"
  related_name_column_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${related_name_column_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not add a related name column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Code"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/columns")"
  related_code_column_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${related_code_column_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not add a related code column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"First name"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows/${related_row_id}/cells/${related_name_column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not set a related name: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"A1"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows/${related_row_id}/cells/${related_code_column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not set a related code: ${response}"; return 1; }

  for spec in \
    '{"name":"Score","type":"number"}' \
    '{"name":"Due","type":"date"}' \
    '{"name":"Done","type":"checkbox"}' \
    '{"name":"Status","type":"select","options":["Open","Closed"]}' \
    '{"name":"Tags","type":"multi_select","options":["Red","Blue"]}' \
    "{\"name\":\"Related\",\"type\":\"relation\",\"relation_database_id\":${other_id},\"relation_display_column_id\":${related_code_column_id}}" \
    "{\"name\":\"Related rows\",\"type\":\"multi_relation\",\"relation_database_id\":${other_id},\"relation_display_column_id\":${related_code_column_id}}"; do
    type="$(jq -r '.type' <<<"${spec}")"
    response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
      --data "${spec}" -w $'\n%{http_code}' \
      "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns")"
    typed_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
    [[ "${response##*$'\n'}" == 201 && "${typed_id}" =~ ^[1-9][0-9]*$ ]] \
      || { fail_test "MDB could not add ${type} column: ${response}"; return 1; }
    typed_ids["${type}"]="${typed_id}"
    case "${type}" in
      number) json_value='"12.5"' ;;
      date) json_value='"2026-11-07"' ;;
      checkbox) json_value='true' ;;
      select) json_value='"Open"' ;;
      multi_select) json_value='["Red","Blue"]' ;;
      relation) json_value="${related_row_id}" ;;
      multi_relation) json_value="[${related_row_id},${second_related_row_id}]" ;;
    esac
    response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
      --data "{\"value\":${json_value}}" -w $'\n%{http_code}' \
      "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_id}")"
    [[ "${response##*$'\n'}" == 200 ]] \
      && jq -e --argjson expected "${json_value}" '.value == $expected' <<<"${response%$'\n'*}" >/dev/null \
      || { fail_test "MDB could not save ${type} cell: ${response}"; return 1; }
  done
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg n "${typed_ids[number]}" --arg d "${typed_ids[date]}" \
      --arg c "${typed_ids[checkbox]}" --arg s "${typed_ids[select]}" \
      --arg m "${typed_ids[multi_select]}" --arg r "${typed_ids[relation]}" \
      --arg mr "${typed_ids[multi_relation]}" \
      --argjson target "${related_row_id}" --argjson second "${second_related_row_id}" \
      --argjson display "${related_code_column_id}" \
      '.rows[0].values[$n] == "12.5" and .rows[0].values[$d] == "2026-11-07" and
       .rows[0].values[$c] == true and .rows[0].values[$s] == "Open" and
       .rows[0].values[$m] == ["Red", "Blue"] and .rows[0].values[$r] == $target and
       .rows[0].values[$mr] == [$target, $second] and
       ([.columns[] | select(.id == ($r | tonumber) or .id == ($mr | tonumber)) |
         .relation_display_column_id] == [$display, $display])' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB typed values did not round-trip: ${response}"; return 1; }
  for type in relation multi_relation; do
    if [[ "${type}" == relation ]]; then display_name='Related'; else display_name='Related rows'; fi
    response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
      --data "{\"name\":\"${display_name}\",\"relation_display_column_id\":${related_name_column_id}}" \
      -w $'\n%{http_code}' \
      "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[${type}]}")"
    [[ "${response##*$'\n'}" == 200 ]] \
      && jq -e --argjson display "${related_name_column_id}" '.relation_display_column_id == $display' \
        <<<"${response%$'\n'*}" >/dev/null \
      || { fail_test "MDB could not change ${type} display column: ${response}"; return 1; }
  done
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg r "${typed_ids[relation]}" --arg mr "${typed_ids[multi_relation]}" \
      --argjson target "${related_row_id}" --argjson second "${second_related_row_id}" \
      '.rows[0].values[$r] == $target and .rows[0].values[$mr] == [$target, $second]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB display change altered related rows: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data "{\"name\":\"Related\",\"relation_display_column_id\":${column_id}}" \
    -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[relation]}")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted a display column from another database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"value\":[${related_row_id},${related_row_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_ids[multi_relation]}")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted duplicate related rows: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"value\":[${related_row_id},${row_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_ids[multi_relation]}")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted a row from another related database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":[]}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_ids[multi_relation]}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.value == []' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not clear related rows: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Score","type":"text"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[number]}")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB changed a populated column type: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Status","options":["Closed"]}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[select]}")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB removed an option in use: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Other"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_ids[select]}")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an unknown select option: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Status","options":["Opened","Closed"],"option_renames":[{"from":"Open","to":"Opened"}]}' \
    -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[select]}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not rename a used select option: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Tags","options":["Crimson","Blue"],"option_renames":[{"from":"Red","to":"Crimson"}]}' \
    -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[multi_select]}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not rename a used multi-select option: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg s "${typed_ids[select]}" --arg m "${typed_ids[multi_select]}" \
      '.rows[0].values[$s] == "Opened" and .rows[0].values[$m] == ["Crimson", "Blue"]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB option renames did not update cells: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Invalid relation","type":"relation","relation_database_id":999999999}' \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted a missing related database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PATCH -H 'Content-Type: application/json' \
    --data '{"name":"Wrong database"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/columns/${column_id}")"
  [[ "${response##*$'\n'}" == 404 ]] \
    || { fail_test "MDB renamed a column through another database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Cross database"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows/${row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 404 ]] \
    || { fail_test "MDB accepted a cell from another database: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows")"
  second_row_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${second_row_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB could not add a row for reordering: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Second entry"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${second_row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not save the second row: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}?limit=1")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson first "${row_id}" --arg heading "${column_id}" \
      '(.rows | length) == 1 and .rows[0].id == $first and .rows[0].values[$heading] == "First entry"' \
      <<<"${response%$'\n'*}" >/dev/null \
    && jq -e '.next_after == "1"' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB first row page was incorrect: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}?limit=1&after=1")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson second "${second_row_id}" --arg heading "${column_id}" \
      '(.rows | length) == 1 and .rows[0].id == $second and .rows[0].values[$heading] == "Second entry" and .next_after == null' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB second row page was incorrect: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}?limit=201")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an oversized row page: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  column_order="$(jq -c '[.columns[].id] | reverse' <<<"${response%$'\n'*}")"
  row_order="$(jq -c '[.rows[].id] | reverse' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"ids\":${column_order}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/order")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not reorder columns: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"ids\":${row_order}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/order")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not reorder rows: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson columns "${column_order}" --argjson rows "${row_order}" \
      --arg heading "${column_id}" \
      '[.columns[].id] == $columns and [.rows[].id] == $rows and
       [.columns[].position] == [range(1; ($columns | length) + 1)] and
       [.rows[].position] == [1, 2] and
       .rows[0].values[$heading] == "Second entry" and
       .rows[1].values[$heading] == "First entry"' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB reorder did not preserve cell values: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"ids\":[${row_id},${row_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/order")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted duplicate row IDs: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"ids\":[${row_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/order")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB accepted an incomplete row order: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"value\":[${related_row_id},${second_related_row_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${typed_ids[multi_relation]}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not prepare a related row deletion: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows/${related_row_id}/usage")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson source "${database_id}" --argjson row "${row_id}" \
      --argjson relation "${typed_ids[relation]}" --argjson multi "${typed_ids[multi_relation]}" \
      '.uses | length == 2 and
       all(.[]; .database_id == $source and .database_name == "Personal records"
         and .row_id == $row and .row_position >= 1) and
       ([.[].column_id] | sort) == ([$relation, $multi] | sort)' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB row usage did not list both relation cells: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/usage")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.uses == []' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB row usage included unrelated cells: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${related_row_id}")"
  [[ "${response##*$'\n'}" == 404 ]] \
    || { fail_test "MDB deleted a row through another database: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/rows/${related_row_id}")"
  [[ "${response##*$'\n'}" == 204 ]] \
    || { fail_test "MDB could not delete a related row: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson row "${row_id}" --arg relation "${typed_ids[relation]}" \
      --arg multi "${typed_ids[multi_relation]}" --argjson remaining "${second_related_row_id}" \
      '([.rows[] | select(.id == $row)][0].values) as $values |
       $values[$relation] == null and $values[$multi] == [$remaining]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB did not clear deleted row references: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson remaining "${second_related_row_id}" \
      '.rows | length == 1 and .[0].id == $remaining and .[0].position == 1' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB did not close the row position gap: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${other_id}/columns/${related_name_column_id}")"
  [[ "${response##*$'\n'}" == 204 ]] \
    || { fail_test "MDB could not delete a relation display column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson relation "${typed_ids[relation]}" \
      --argjson multi "${typed_ids[multi_relation]}" \
      '[.columns[] | select(.id == $relation or .id == $multi) | .relation_display_column_id] == [null, null]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB did not reset deleted display column references: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[number]}")"
  [[ "${response##*$'\n'}" == 204 ]] \
    || { fail_test "MDB could not delete a populated column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson removed "${typed_ids[number]}" --arg key "${typed_ids[number]}" \
      '([.columns[].id] | index($removed)) == null and
       [.columns[].position] == [range(1; (.columns | length) + 1)] and
       all(.rows[]; .values[$key] == null)' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB did not remove the column and compact its order: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns/${typed_ids[number]}")"
  [[ "${response##*$'\n'}" == 404 ]] \
    || { fail_test "MDB deleted a column twice: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"personal records"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB accepted a duplicate name: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"   "}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an empty name: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson id "${database_id}" \
      '.databases | length == 2 and .[1].id == $id and .[1].name == "Personal records"' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB list did not return the created database: ${response}"; return 1; }
)

register_test_case test_mdb_database_library

test_mdb_csv_import() (
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'login fixture unavailable; skipping MDB CSV import test'
    return 200
  fi
  local cookie_file csv_file bad_file large_file response database_id i
  cookie_file="$(mktemp)"
  csv_file="$(mktemp)"
  bad_file="$(mktemp)"
  large_file="$(mktemp)"
  trap 'rm -f -- "${cookie_file}" "${csv_file}" "${bad_file}" "${large_file}"' EXIT
  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "MDB CSV fixture login failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"CSV import test"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  database_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${database_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB CSV database creation failed: ${response}"; return 1; }

  printf '\xef\xbb\xbfWatched,Release Date,Rating,Genre,Flag\nNo,"June 24, 2016",12.5,"Action, Adventure",1\nYes,"May 19, 1999",7,Drama,0\nNo,"June 24, 2016",12.5,"Action, Adventure",1\n' > "${csv_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=import.csv" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import/preview")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.row_count == 3 and
      ([.columns[] | select(.name == "Watched")][0].type == "checkbox") and
      ([.columns[] | select(.name == "Release Date")][0].type == "date") and
      ([.columns[] | select(.name == "Rating")][0].type == "number") and
      ([.columns[] | select(.name == "Genre")][0].type == null) and
      ([.columns[] | select(.name == "Flag")][0].type == null)' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV preview inferred the wrong types: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=import.csv" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB imported an unresolved CSV column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns == [] and .rows == []' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB left partial CSV data after a failed import: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=import.csv" \
    -F 'types={"Genre":"multi_select","Flag":"checkbox"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns_added == 5 and .rows_added == 2 and .rows_skipped == 1 and .options_added == 3' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV import failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '(.columns | map({key:.name,value:(.id | tostring)}) | from_entries) as $id |
      [.rows[].position] == [1,2] and
      .rows[0].values[$id["Release Date"]] == "2016-06-24" and
      .rows[0].values[$id.Rating] == "12.5" and
      .rows[0].values[$id.Genre] == ["Action","Adventure"] and
      .rows[1].values[$id.Watched] == true and
      .rows[1].values[$id.Genre] == ["Drama"]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV values did not round-trip: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=import.csv" \
    -F 'types={"Genre":"multi_select","Flag":"checkbox"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns_added == 0 and .rows_added == 0 and .rows_skipped == 3' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV reimport duplicated rows: ${response}"; return 1; }

  printf 'Extra,Rating\nNew value,not-a-number\n' > "${bad_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${bad_file};filename=bad.csv" \
    -F 'types={"Extra":"text"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an invalid value for an existing column: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns | length == 5 and ([.[].name] | index("Extra") == null)' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB failed to roll back invalid CSV import: ${response}"; return 1; }
  printf 'rating,Extra\n9,New entry\n' > "${bad_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${bad_file};filename=more.csv" \
    -F 'types={"Extra":"text"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns_added == 1 and .rows_added == 1 and .rows_skipped == 0' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV could not add a missing column and row: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '(.columns | map({key:.name,value:(.id | tostring)}) | from_entries) as $id |
      (.columns | length) == 6 and (.rows | length) == 3 and
      .rows[2].values[$id.Rating] == "9" and .rows[2].values[$id.Extra] == "New entry"' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV did not preserve the new column and row: ${response}"; return 1; }

  printf 'Long text\n' > "${large_file}"
  for ((i = 1; i <= 100; i++)); do
    printf 'item-%03d-%0800d\n' "${i}" 0 >> "${large_file}"
  done
  response="$(curl -sS -b "${cookie_file}" -F "file=@${large_file};filename=large.csv" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns_added == 1 and .rows_added == 100' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB CSV request over 64 KiB was rejected: ${response}"; return 1; }
)

register_test_case test_mdb_csv_import

test_mdb_csv_relations() (
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'login fixture unavailable; skipping MDB relation CSV test'
    return 200
  fi
  local cookie_file csv_file response target_id source_id lookup_id known_id related_id tags_id rating_id
  local new_id missing_id relation_settings
  cookie_file="$(mktemp)"
  csv_file="$(mktemp)"
  trap 'rm -f -- "${cookie_file}" "${csv_file}"' EXIT
  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "MDB relation fixture login failed: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"CSV related lookup"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  target_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${target_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB relation target creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Name","type":"text"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/columns")"
  lookup_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${lookup_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB relation lookup column creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows")"
  known_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${known_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB relation known row creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Known"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows/${known_id}/cells/${lookup_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB relation known value creation failed: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"CSV relation source"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  source_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${source_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB relation source creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson target "${target_id}" --argjson lookup "${lookup_id}" \
      '{name:"Related",type:"relation",relation_database_id:$target,relation_display_column_id:$lookup}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/columns")"
  related_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${related_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB existing relation column creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson target "${target_id}" --argjson lookup "${lookup_id}" \
      '{name:"Tags",type:"multi_relation",relation_database_id:$target,relation_display_column_id:$lookup}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/columns")"
  tags_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${tags_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB existing multi-relation column creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Rating","type":"number"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/columns")"
  rating_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${rating_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB relation rating column creation failed: ${response}"; return 1; }

  relation_settings="$(jq -nc --argjson target "${target_id}" --argjson lookup "${lookup_id}" \
    '{Related:{database_id:$target,lookup_column_id:$lookup},
      Tags:{database_id:$target,lookup_column_id:$lookup},
      "New Relation":{database_id:$target,lookup_column_id:$lookup}}')"
  printf 'Related,Tags,New Relation\nKnown,"Known, New",Known\nMissing,"New, Missing",Missing\n' > "${csv_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=relations.csv" \
    -F 'types={"New Relation":"relation"}' --form-string "relations=${relation_settings}" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.columns_added == 1 and .rows_added == 2 and .related_rows_added == 2' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB relation CSV import failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg lookup "${lookup_id}" \
      '[.rows[].values[$lookup]] == ["Known","New","Missing"]' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB related rows were not created with lookup values: ${response}"; return 1; }
  new_id="$(jq -r --arg lookup "${lookup_id}" '.rows[] | select(.values[$lookup] == "New") | .id' <<<"${response%$'\n'*}")"
  missing_id="$(jq -r --arg lookup "${lookup_id}" '.rows[] | select(.values[$lookup] == "Missing") | .id' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg related "${related_id}" --arg tags "${tags_id}" \
      --argjson known "${known_id}" --argjson new "${new_id}" --argjson missing "${missing_id}" \
      '(.columns[] | select(.name == "New Relation") | .id | tostring) as $new_column |
       (.rows | length) == 2 and
       .rows[0].values[$related] == $known and .rows[0].values[$tags] == [$known,$new] and
       .rows[0].values[$new_column] == $known and
       .rows[1].values[$related] == $missing and .rows[1].values[$tags] == [$new,$missing] and
       .rows[1].values[$new_column] == $missing' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB imported relation IDs incorrectly: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=relations.csv" \
    --form-string "relations=${relation_settings}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/import")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e '.rows_added == 0 and .related_rows_added == 0 and .rows_skipped == 2' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB repeated relation CSV import duplicated data: ${response}"; return 1; }

  printf 'Related,Rating\nNeverSeen,not-a-number\n' > "${csv_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=invalid.csv" \
    --form-string "relations=${relation_settings}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/import")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB relation import accepted invalid number: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg lookup "${lookup_id}" \
      '(.rows | length) == 3 and ([.rows[].values[$lookup]] | index("NeverSeen")) == null' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB left a related row after failed CSV import: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows")"
  [[ "${response##*$'\n'}" == 201 ]] \
    || { fail_test "MDB duplicate lookup row creation failed: ${response}"; return 1; }
  local duplicate_id
  duplicate_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":"Known"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows/${duplicate_id}/cells/${lookup_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB duplicate lookup value creation failed: ${response}"; return 1; }
  printf 'Related\nKnown\n' > "${csv_file}"
  response="$(curl -sS -b "${cookie_file}" -F "file=@${csv_file};filename=ambiguous.csv" \
    --form-string "relations=${relation_settings}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${source_id}/import")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "MDB relation import chose an ambiguous lookup row: ${response}"; return 1; }

  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson column "${lookup_id}" \
      '{column_id:$column,values:["Batch One","Batch Two"]}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows/batch")"
  [[ "${response##*$'\n'}" == 201 ]] \
    && jq -e --arg lookup "${lookup_id}" \
      '(.rows | length) == 2 and .rows[0].values[$lookup] == "Batch One" and
       .rows[1].values[$lookup] == "Batch Two"' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not add named related rows together: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --argjson column "${lookup_id}" \
      '{column_id:$column,values:["Should roll back",""]}')" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows/batch")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an invalid related row batch: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg lookup "${lookup_id}" \
      '(.rows | length) == 6 and ([.rows[].values[$lookup]] | index("Should roll back")) == null' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB related row batch did not roll back: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"column_id":null,"values":[null]}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${target_id}/rows/batch")"
  [[ "${response##*$'\n'}" == 201 ]] \
    && jq -e '(.rows | length) == 1 and .rows[0].values == {}' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not add a blank related row: ${response}"; return 1; }
)

register_test_case test_mdb_csv_relations

test_mdb_image_column() (
  if [[ -z "${TEST_EMAIL}" ]]; then
    skip_test 'login fixture unavailable; skipping MDB image column test'
    return 200
  fi
  local cookie_file png_file response database_id column_id row_id image_id
  cookie_file="$(mktemp)"
  png_file="$(mktemp)"
  trap 'rm -f -- "${cookie_file}" "${png_file}"' EXIT
  response="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg email "${TEST_EMAIL}" '{email:$email,password:"test_password_123"}')" \
    -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "MDB image fixture login failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Image column test"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases")"
  database_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${database_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB image database creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{"name":"Artwork","type":"image"}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/columns")"
  column_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${column_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB image column creation failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data '{}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows")"
  row_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${row_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB image row creation failed: ${response}"; return 1; }
  php -r '$im=imagecreatetruecolor(1,1); $seed=crc32($argv[2]); $color=imagecolorallocate($im,($seed>>16)&255,($seed>>8)&255,$seed&255); imagefill($im,0,0,$color); imagepng($im,$argv[1]); imagedestroy($im);' \
    "${png_file}" "${API_TEST_RUN_ID}"
  response="$(curl -sS -b "${cookie_file}" -X POST -H 'Content-Type: application/octet-stream' \
    -H "X-Image-Name: mdb-${API_TEST_RUN_ID}.png" --data-binary @"${png_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  image_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "${response##*$'\n'}" == 201 && "${image_id}" =~ ^[1-9][0-9]*$ ]] \
    || { fail_test "MDB image upload failed: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":999999999999}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 400 ]] \
    || { fail_test "MDB accepted an unknown image: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data "{\"value\":${image_id}}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson id "${image_id}" '.value == $id' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB could not save an image: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg key "${column_id}" --argjson id "${image_id}" \
      '.rows[0].values[$key] == $id' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB image ID did not round-trip: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -H 'Content-Type: application/json' \
    --data "{\"image_ids\":[${image_id}]}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/usage")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --argjson database "${database_id}" --argjson row "${row_id}" \
      '.images[0].uses | any(.[]; .kind == "mdb_cell" and .database_id == $database and .row_id == $row and .column_name == "Artwork")' \
      <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "Media usage omitted MDB image cell: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${image_id}")"
  [[ "${response##*$'\n'}" == 409 ]] \
    || { fail_test "Media deleted an image used by MDB without confirmation: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X DELETE -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images/${image_id}?force=1")"
  [[ "${response##*$'\n'}" == 204 ]] \
    || { fail_test "Media could not force-delete an MDB image: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    && jq -e --arg key "${column_id}" --argjson id "${image_id}" \
      '.rows[0].values[$key] == $id' <<<"${response%$'\n'*}" >/dev/null \
    || { fail_test "MDB lost the missing-image reference: ${response}"; return 1; }
  response="$(curl -sS -b "${cookie_file}" -X PUT -H 'Content-Type: application/json' \
    --data '{"value":null}' -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/mdb/databases/${database_id}/rows/${row_id}/cells/${column_id}")"
  [[ "${response##*$'\n'}" == 200 ]] \
    || { fail_test "MDB could not clear a deleted image: ${response}"; return 1; }
)

register_test_case test_mdb_image_column
