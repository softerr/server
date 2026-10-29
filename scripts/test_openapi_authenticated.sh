#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
API_TEST_BASE_URL="${API_TEST_BASE_URL:-http://127.0.0.1}"
if [[ ! "${API_TEST_BASE_URL}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
  echo 'Authenticated OpenAPI checks require a local HTTP origin.' >&2
  exit 1
fi
for command_name in curl jq psql php python3 schemathesis sudo base64; do
  command -v "${command_name}" >/dev/null || { echo "Missing command: ${command_name}" >&2; exit 1; }
done
sudo -n -u postgres psql -X -Atq -d auth -c 'SELECT 1' >/dev/null

origin="${API_TEST_BASE_URL%/}"
test_dir="$(mktemp -d)"
auth_user_id=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${auth_user_id}" =~ ^[1-9][0-9]*$ ]]; then
    sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -q -d quiz \
      -c "DELETE FROM public.\"user\" WHERE auth_user_id = ${auth_user_id}" >/dev/null || result=1
    sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -q -d media \
      -c "DELETE FROM public.image WHERE owner_auth_user_id = ${auth_user_id};
          DELETE FROM public.image_blob b WHERE NOT EXISTS
          (SELECT 1 FROM public.image i WHERE i.blob_id = b.id);" >/dev/null || result=1
    sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -q -d auth \
      -c "DELETE FROM public.\"user\" WHERE id = ${auth_user_id}" >/dev/null || result=1
  fi
  rm -rf -- "${test_dir}"
  exit "${result}"
}
trap cleanup EXIT

suffix="$(date +%s%N)_${RANDOM}_$$"
username="openapi_test_${suffix}"
email="${username}@example.test"
password="openapi_${suffix}"
password_hash="$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "${password}")"
auth_user_id="$(sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -Atq -d auth \
  -v fixture_username="${username}" -v fixture_email="${email}" -v fixture_password_hash="${password_hash}" <<'SQL'
INSERT INTO public."user" (username, password, email, role, verified, approved_at)
VALUES (:'fixture_username', :'fixture_password_hash', :'fixture_email', 'admin', TRUE, CURRENT_TIMESTAMP)
RETURNING id;
SQL
)"
[[ "${auth_user_id}" =~ ^[1-9][0-9]*$ ]] || { echo 'Could not create contract test user.' >&2; exit 1; }

cookie_file="${test_dir}/cookies"
login="$(curl -sS -c "${cookie_file}" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg email "${email}" --arg password "${password}" \
    '{email:$email,password:$password}')" \
  -w $'\n%{http_code}' "${origin}/api/auth/login")"
[[ "${login##*$'\n'}" == 200 ]] || { echo "Fixture login failed: HTTP ${login##*$'\n'}" >&2; exit 1; }
OPENAPI_AUTH_COOKIE="$(awk '$6 == "softerr_session" {print $7}' "${cookie_file}")"
[[ -n "${OPENAPI_AUTH_COOKIE}" ]] || { echo 'Fixture session cookie is missing.' >&2; exit 1; }

fixture_json() {
  local method="$1" path="$2" body="$3" expected="$4" response
  response="$(curl -sS -b "${cookie_file}" -X "${method}" -H 'Content-Type: application/json' \
    --data "${body}" -w $'\n%{http_code}' "${origin}${path}")"
  if [[ "${response##*$'\n'}" != "${expected}" ]]; then
    echo "Fixture ${method} ${path} returned HTTP ${response##*$'\n'}; expected ${expected}." >&2
    exit 1
  fi
  printf '%s' "${response%$'\n'*}"
}

quiz="$(fixture_json POST /api/quiz/quizzes '{"name":"OpenAPI contract fixture"}' 201)"
quiz_id="$(jq -r '.id // empty' <<<"${quiz}")"
[[ "${quiz_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
fixture_json POST "/api/quiz/quizzes/${quiz_id}/questions" \
  '{"template":"no_answer","prompt":"OpenAPI contract question","config":{}}' 201 >/dev/null
fixture_json POST "/api/quiz/quizzes/${quiz_id}/questions" \
  '{"template":"show_answer","prompt":"Reveal this answer","config":{"answer":"Known answer"}}' 201 >/dev/null
attempt="$(fixture_json POST "/api/quiz/quizzes/${quiz_id}/attempts" '{}' 200)"
attempt_id="$(jq -r '.id // empty' <<<"${attempt}")"
question_id="$(jq -r '.questions[0].id // empty' <<<"${attempt}")"
[[ "${attempt_id}" =~ ^[1-9][0-9]*$ && "${question_id}" =~ ^[1-9][0-9]*$ ]] || exit 1
reveal_question_id="$(sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -Atq -d quiz \
  -c "SELECT id FROM public.quiz_attempt_question WHERE attempt_id = ${attempt_id} AND position = 2")"
[[ "${reveal_question_id}" =~ ^[1-9][0-9]*$ ]] || exit 1

printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' \
  | base64 -d > "${test_dir}/fixture.png"
printf '%s' "${suffix}" >> "${test_dir}/fixture.png"
image_response="$(curl -sS -b "${cookie_file}" --data-binary @"${test_dir}/fixture.png" \
  -H "X-Image-Name: ${username}.png" -w $'\n%{http_code}' "${origin}/api/media/images")"
[[ "${image_response##*$'\n'}" == 201 ]] || { echo "Fixture image upload failed: HTTP ${image_response##*$'\n'}" >&2; exit 1; }
image_id="$(jq -r '.id // empty' <<<"${image_response%$'\n'*}")"
[[ "${image_id}" =~ ^[1-9][0-9]*$ ]] || exit 1

export API_TEST_BASE_URL OPENAPI_AUTH_COOKIE
export OPENAPI_USERID="${auth_user_id}" OPENAPI_QUIZID="${quiz_id}"
export OPENAPI_ATTEMPTID="${attempt_id}" OPENAPI_QUESTIONID="${question_id}"
export OPENAPI_REVEALQUESTIONID="${reveal_question_id}"
export OPENAPI_IMAGEID="${image_id}"
python3 "${REPO_ROOT}/tests/api/authenticated_openapi.py" \
  "${REPO_ROOT}/docs/openapi.yaml" "${test_dir}/authenticated-openapi.yaml"
cd "${test_dir}"
seed_args=()
if [[ -n "${OPENAPI_TEST_SEED:-}" ]]; then seed_args=(--seed "${OPENAPI_TEST_SEED}"); fi
schemathesis run authenticated-openapi.yaml \
  --origin "${origin}" \
  --header "Cookie: softerr_session=${OPENAPI_AUTH_COOKIE}" \
  --phases examples,fuzzing \
  --mode positive \
  --workers 1 \
  --max-examples 3 \
  --checks not_a_server_error,status_code_conformance,content_type_conformance,response_schema_conformance \
  "${seed_args[@]}" \
  --no-color
