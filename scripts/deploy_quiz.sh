#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_quiz.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREBUILT_DIST_DIR="${QUIZ_DIST_DIR:-${REMOTE_DIR:-/tmp/workflow-artifacts}/app/quiz/dist}"
TARGET_DIR="${QUIZ_TARGET_DIR:-/var/www/quiz}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"

if [[ ! -f "${PREBUILT_DIST_DIR}/index.html" ]]; then
  echo "Prebuilt quiz artifacts not found: ${PREBUILT_DIST_DIR}"
  echo "Build app/quiz in GitHub Actions first, then upload artifacts."
  echo "Optional override: set QUIZ_DIST_DIR to a valid dist directory."
  exit 1
fi

source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"
DIST_DIR="${PREBUILT_DIST_DIR}"
echo "Using prebuilt quiz artifacts: ${DIST_DIR}"
echo "Deploying to: ${TARGET_DIR}"
atomic_deploy_dir "${DIST_DIR}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}" \
  verify_local_app_route /quiz/ file "${TARGET_DIR}/index.html"

echo "Quiz deployed successfully."
echo "Artifacts: ${DIST_DIR}"
echo "Target: ${TARGET_DIR}"
