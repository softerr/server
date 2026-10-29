#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
API_TEST_BASE_URL="${API_TEST_BASE_URL:-http://127.0.0.1:8080}"

if [[ ! "${API_TEST_BASE_URL}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
  echo "API_TEST_BASE_URL must be a local HTTP origin (localhost or 127.0.0.1)." >&2
  exit 1
fi
if ! command -v schemathesis >/dev/null 2>&1; then
  echo "Schemathesis is required. Install it before running this script." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to check API readiness." >&2
  exit 1
fi

origin="${API_TEST_BASE_URL%/}"
if ! curl -fsS --connect-timeout 3 --max-time 10 "${origin}/api/" >/dev/null; then
  echo "API is not ready at ${origin}/api/. Start the VM with: bash scripts/qemu.sh start" >&2
  exit 1
fi
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${origin}/api/auth/logout")" != 200 ]]; then
  echo 'Unauthenticated logout did not return HTTP 200.' >&2
  exit 1
fi

# Schemathesis stores failure data beneath its working directory. Keep that
# generated data out of the repository, including when a check fails.
test_dir="$(mktemp -d)"
trap 'rm -rf -- "${test_dir}"' EXIT
cd "${test_dir}"

seed_args=()
if [[ -n "${OPENAPI_TEST_SEED:-}" ]]; then seed_args=(--seed "${OPENAPI_TEST_SEED}"); fi
schemathesis run "${REPO_ROOT}/docs/openapi.yaml" \
  --origin "${origin}" \
  --include-operation-id-regex '^(getReadiness|logout)$' \
  --phases examples,fuzzing \
  --mode positive \
  --max-examples 5 \
  --checks not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance \
  "${seed_args[@]}" \
  --no-color
