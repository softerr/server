#!/usr/bin/env bash

set -euo pipefail

DB_NAME="${API_TEST_DB_NAME:-auth}"
TEST_SUFFIX="$(date +%s)_${RANDOM}"
TEST_USERNAME="token_prune_${TEST_SUFFIX}"
TEST_EMAIL="${TEST_USERNAME}@example.test"
TEST_USER_ID=""

psql_as_postgres() {
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "${DB_NAME}" -Atqc "$1"
}

cleanup() {
  if [[ -n "${TEST_USER_ID}" ]]; then
    psql_as_postgres "DELETE FROM public.\"user\" WHERE id = ${TEST_USER_ID};" >/dev/null || true
  fi
}
trap cleanup EXIT

index_count="$(psql_as_postgres "SELECT count(*) FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN ('user_token_hash_idx', 'user_token_user_type_id_idx', 'user_token_verify_expiry_idx');")"
if [[ "${index_count}" != 3 ]]; then
  echo "Expected all three user_token indexes; found ${index_count}."
  exit 1
fi

TEST_USER_ID="$(psql_as_postgres "INSERT INTO public.\"user\" (username, password, email)
  VALUES ('${TEST_USERNAME}', 'test-only', '${TEST_EMAIL}') RETURNING id;")"
if [[ ! "${TEST_USER_ID}" =~ ^[0-9]+$ ]]; then
  echo "Could not create a test user for token pruning."
  exit 1
fi

psql_as_postgres "INSERT INTO public.user_token (user_id, type, expires)
  VALUES (${TEST_USER_ID}, 'verify', CURRENT_TIMESTAMP - INTERVAL '1 minute'),
         (${TEST_USER_ID}, 'verify', CURRENT_TIMESTAMP + INTERVAL '1 hour'),
         (${TEST_USER_ID}, 'password_reset', CURRENT_TIMESTAMP - INTERVAL '1 minute'),
         (${TEST_USER_ID}, 'password_reset', CURRENT_TIMESTAMP + INTERVAL '1 hour'),
         (${TEST_USER_ID}, 'password_changed', CURRENT_TIMESTAMP - INTERVAL '1 minute');" >/dev/null

sudo -n systemctl start softerr-prune-user-tokens.service

counts="$(psql_as_postgres "SELECT
    count(*) FILTER (WHERE expires <= CURRENT_TIMESTAMP),
    count(*) FILTER (WHERE expires > CURRENT_TIMESTAMP)
  FROM public.user_token WHERE user_id = ${TEST_USER_ID};")"
if [[ "${counts}" != '0|2' ]]; then
  echo "Token pruning returned expired|valid counts ${counts}; expected 0|2."
  exit 1
fi

echo "Account-token indexes and pruning passed."
