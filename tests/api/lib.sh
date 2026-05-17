#!/usr/bin/env bash

TEST_CASES=()
TEST_EMAIL=""
TEST_USERNAME=""
TEST_VERIFY_TOKEN=""
TEST_LAST_RESPONSE_STATUS=""
TEST_LAST_RESPONSE_BODY=""
TEST_SKIP_REASON=""

register_test_case() {
  local fn_name="$1"
  TEST_CASES+=("${fn_name}")
}

fail_test() {
  local message="$1"
  echo "  FAIL: ${message}"
  return 1
}

skip_test() {
  TEST_SKIP_REASON="$1"
  return 200
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}"
    exit 1
  fi
}

api_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${API_TEST_BASE_URL%/}${path}"
  local response

  if [[ -n "${body}" ]]; then
    response="$(curl -sS -X "${method}" \
      -H "Content-Type: application/json" \
      --data "${body}" \
      -w $'\n%{http_code}' \
      "${url}")"
  else
    response="$(curl -sS -X "${method}" \
      -H "Content-Type: application/json" \
      -w $'\n%{http_code}' \
      "${url}")"
  fi

  TEST_LAST_RESPONSE_STATUS="${response##*$'\n'}"
  TEST_LAST_RESPONSE_BODY="${response%$'\n'*}"
}

assert_status() {
  local expected="$1"
  if [[ "${TEST_LAST_RESPONSE_STATUS}" != "${expected}" ]]; then
    fail_test "expected HTTP ${expected}, got ${TEST_LAST_RESPONSE_STATUS}; body=${TEST_LAST_RESPONSE_BODY}"
    return 1
  fi
}

assert_json_expression() {
  local expression="$1"
  if ! jq -e "${expression}" >/dev/null 2>&1 <<<"${TEST_LAST_RESPONSE_BODY}"; then
    fail_test "response does not satisfy jq expression: ${expression}; body=${TEST_LAST_RESPONSE_BODY}"
    return 1
  fi
}

assert_json_value() {
  local expression="$1"
  local expected="$2"
  local value
  value="$(jq -r "${expression}" <<<"${TEST_LAST_RESPONSE_BODY}")"
  if [[ "${value}" != "${expected}" ]]; then
    fail_test "expected ${expression}=${expected}, got ${value}; body=${TEST_LAST_RESPONSE_BODY}"
    return 1
  fi
}

json_field_or_empty() {
  local expression="$1"
  jq -r "${expression} // empty" <<<"${TEST_LAST_RESPONSE_BODY}" 2>/dev/null || true
}

create_test_identity() {
  local suffix
  suffix="$(date +%s)-${RANDOM}"
  TEST_USERNAME="api_test_${suffix}"
  TEST_EMAIL="softerr.dev+${suffix}@gmail.com"
}

sql_escape_literal() {
  local input="$1"
  printf '%s' "${input//\'/\'\'}"
}

fetch_verify_token_for_email() {
  local email="$1"
  local escaped_email
  escaped_email="$(sql_escape_literal "${email}")"

  if ! command -v psql >/dev/null 2>&1; then
    if [[ "${API_TEST_REQUIRE_DB:-1}" == "1" ]]; then
      fail_test "psql is not installed; cannot fetch verification token for verify endpoint test"
      return 1
    fi
    skip_test "psql not available; skipping verify success test"
    return 200
  fi

  local query
  query="SELECT t.hash
         FROM public.user_token t
         JOIN public.\"user\" u ON u.id = t.user_id
         WHERE u.email = '${escaped_email}'
           AND t.type = 'verify'
         ORDER BY t.id DESC
         LIMIT 1;"

  local token=""
  if token="$(sudo -n -u "${API_TEST_DB_SUPERUSER}" psql -d "${API_TEST_DB_NAME}" -Atqc "${query}" 2>/dev/null)"; then
    :
  else
    if [[ "${API_TEST_REQUIRE_DB:-1}" == "1" ]]; then
      fail_test "cannot query PostgreSQL for verification token (sudo/psql access failed)"
      return 1
    fi
    skip_test "cannot query PostgreSQL; skipping verify success test"
    return 200
  fi

  token="$(printf '%s' "${token}" | tr -d '\r\n')"
  if [[ -z "${token}" ]]; then
    if [[ "${API_TEST_REQUIRE_DB:-1}" == "1" ]]; then
      fail_test "verification token not found for ${email}"
      return 1
    fi
    skip_test "verification token not found; skipping verify success test"
    return 200
  fi

  TEST_VERIFY_TOKEN="${token}"
}
