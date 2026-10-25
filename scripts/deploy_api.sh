#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_api.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_API_DIR="${SCRIPT_DIR}/../app/api"
REMOTE_API_DIR="${REMOTE_DIR:-/tmp/workflow-artifacts}/app/api"

SOURCE_DIR="${API_SOURCE_DIR:-}"
if [[ -z "${SOURCE_DIR}" ]]; then
  if [[ -f "${REPO_API_DIR}/index.php" ]]; then
    SOURCE_DIR="${REPO_API_DIR}"
  elif [[ -f "${REMOTE_API_DIR}/index.php" ]]; then
    SOURCE_DIR="${REMOTE_API_DIR}"
  fi
fi

if [[ -z "${SOURCE_DIR}" ]] || [[ ! -f "${SOURCE_DIR}/index.php" ]]; then
  echo "Could not find API source directory."
  echo "Set API_SOURCE_DIR to a directory that contains index.php."
  exit 1
fi

TARGET_DIR="${API_TARGET_DIR:-/var/www/api}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"
source "${SCRIPT_DIR}/lib/atomic_deploy.sh"

echo "Deploying API from: ${SOURCE_DIR}"
atomic_deploy_dir "${SOURCE_DIR}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}"

echo "API deployed successfully."
echo "Source: ${SOURCE_DIR}"
echo "Target: ${TARGET_DIR}"
