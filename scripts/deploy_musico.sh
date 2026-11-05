#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_musico.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREBUILT_DIST_DIR="${MUSICO_DIST_DIR:-${REMOTE_DIR:-/tmp/workflow-artifacts}/app/musico/dist}"
TARGET_DIR="${MUSICO_TARGET_DIR:-/var/www/musico}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"

if [[ ! -f "${PREBUILT_DIST_DIR}/index.html" ]]; then
  echo "Prebuilt Musico artifacts not found: ${PREBUILT_DIST_DIR}"
  echo "Build app/musico in GitHub Actions first, then upload artifacts."
  echo "Optional override: set MUSICO_DIST_DIR to a valid dist directory."
  exit 1
fi

source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"
DIST_DIR="${PREBUILT_DIST_DIR}"
echo "Using prebuilt Musico artifacts: ${DIST_DIR}"
echo "Deploying to: ${TARGET_DIR}"
atomic_deploy_dir "${DIST_DIR}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}" \
  verify_local_app_route /musico/ file "${TARGET_DIR}/index.html"

echo "Musico deployed successfully."
echo "Artifacts: ${DIST_DIR}"
echo "Target: ${TARGET_DIR}"
