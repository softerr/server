#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_quiz.sh)."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not installed. Install Node.js/npm first."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_QUIZ_DIR="${SCRIPT_DIR}/../app/quiz"
REMOTE_QUIZ_DIR="/tmp/workflow-artifacts/app/quiz"

SOURCE_DIR="${QUIZ_SOURCE_DIR:-}"
if [[ -z "${SOURCE_DIR}" ]]; then
  if [[ -f "${REPO_QUIZ_DIR}/package.json" ]]; then
    SOURCE_DIR="${REPO_QUIZ_DIR}"
  elif [[ -f "${REMOTE_QUIZ_DIR}/package.json" ]]; then
    SOURCE_DIR="${REMOTE_QUIZ_DIR}"
  fi
fi

if [[ -z "${SOURCE_DIR}" ]] || [[ ! -f "${SOURCE_DIR}/package.json" ]]; then
  echo "Could not find quiz source directory."
  echo "Set QUIZ_SOURCE_DIR to a directory that contains app/quiz package.json."
  exit 1
fi

TARGET_DIR="${QUIZ_TARGET_DIR:-/var/www/quiz}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"

echo "Building quiz app from: ${SOURCE_DIR}"
cd "${SOURCE_DIR}"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run build

DIST_DIR="${SOURCE_DIR}/dist"
if [[ ! -d "${DIST_DIR}" ]]; then
  echo "Build finished, but dist directory was not found: ${DIST_DIR}"
  exit 1
fi

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
echo "Source: ${SOURCE_DIR}"
echo "Target: ${TARGET_DIR}"
