#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_quiz.sh)."
  exit 1
fi

PREBUILT_DIST_DIR="${QUIZ_DIST_DIR:-/tmp/workflow-artifacts/app/quiz/dist}"
TARGET_DIR="${QUIZ_TARGET_DIR:-/var/www/quiz}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"

if [[ ! -d "${PREBUILT_DIST_DIR}" ]]; then
  echo "Prebuilt quiz artifacts not found: ${PREBUILT_DIST_DIR}"
  echo "Build app/quiz in GitHub Actions first, then upload artifacts."
  echo "Optional override: set QUIZ_DIST_DIR to a valid dist directory."
  exit 1
fi

DIST_DIR="${PREBUILT_DIST_DIR}"
echo "Using prebuilt quiz artifacts: ${DIST_DIR}"
echo "Deploying to: ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${DIST_DIR}/" "${TARGET_DIR}/"
else
  find "${TARGET_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} \;
  cp -a "${DIST_DIR}/." "${TARGET_DIR}/"
fi

chown -R "${WEB_USER}:${WEB_GROUP}" "${TARGET_DIR}"
find "${TARGET_DIR}" -type d -exec chmod 755 {} \;
find "${TARGET_DIR}" -type f -exec chmod 644 {} \;

echo "Quiz deployed successfully."
echo "Artifacts: ${DIST_DIR}"
echo "Target: ${TARGET_DIR}"
