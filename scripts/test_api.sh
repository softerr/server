#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEST_ROOT="${REPO_ROOT}/tests/api"
CASES_DIR="${TEST_ROOT}/cases"

if [[ ! -d "${CASES_DIR}" ]]; then
  echo "API test cases directory not found: ${CASES_DIR}"
  exit 1
fi

API_TEST_BASE_URL="${API_TEST_BASE_URL:-http://127.0.0.1}"
API_TEST_DB_NAME="${API_TEST_DB_NAME:-auth}"
API_TEST_DB_SUPERUSER="${API_TEST_DB_SUPERUSER:-postgres}"
API_TEST_REQUIRE_DB="${API_TEST_REQUIRE_DB:-1}"
API_TEST_REQUIRE_EMAIL="${API_TEST_REQUIRE_EMAIL:-1}"

export API_TEST_BASE_URL API_TEST_DB_NAME API_TEST_DB_SUPERUSER API_TEST_REQUIRE_DB API_TEST_REQUIRE_EMAIL

source "${TEST_ROOT}/lib.sh"

require_command curl
require_command jq

echo "API test base URL: ${API_TEST_BASE_URL}"
echo "API DB name: ${API_TEST_DB_NAME}"
echo "API require DB token checks: ${API_TEST_REQUIRE_DB}"
echo "API require email delivery checks: ${API_TEST_REQUIRE_EMAIL}"

if ! curl -sS --connect-timeout 5 --max-time 10 "${API_TEST_BASE_URL%/}/api" >/dev/null; then
  echo "API precheck failed: cannot reach ${API_TEST_BASE_URL%/}/api"
  echo "Ensure API is running and reachable from this host, then rerun tests."
  exit 1
fi

mapfile -t case_files < <(find "${CASES_DIR}" -maxdepth 1 -type f -name '*.sh' -printf '%f\n' | sort)
if [[ "${#case_files[@]}" -eq 0 ]]; then
  echo "No API test case files found in ${CASES_DIR}"
  exit 1
fi

for case_file in "${case_files[@]}"; do
  source "${CASES_DIR}/${case_file}"
done

if [[ "${#TEST_CASES[@]}" -eq 0 ]]; then
  echo "No API tests registered."
  exit 1
fi

pass_count=0
fail_count=0
skip_count=0

for test_case in "${TEST_CASES[@]}"; do
  echo "Running ${test_case}..."
  TEST_SKIP_REASON=""

  set +e
  "${test_case}"
  rc=$?
  set -e

  if [[ ${rc} -eq 0 ]]; then
    echo "  PASS"
    pass_count=$((pass_count + 1))
  elif [[ ${rc} -eq 200 ]]; then
    echo "  SKIP: ${TEST_SKIP_REASON:-no reason provided}"
    skip_count=$((skip_count + 1))
  else
    echo "  FAIL"
    fail_count=$((fail_count + 1))
  fi
done

echo "API test summary: pass=${pass_count} fail=${fail_count} skip=${skip_count}"

if [[ ${fail_count} -ne 0 ]]; then
  exit 1
fi
