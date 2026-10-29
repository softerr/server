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
  echo "Set API_SOURCE_DIR to a directory that contains the API entry files."
  exit 1
fi
for entrypoint in index auth quiz media; do
  if [[ ! -f "${SOURCE_DIR}/${entrypoint}.php" ]]; then
    echo "Missing API entry file: ${SOURCE_DIR}/${entrypoint}.php" >&2
    exit 1
  fi
done

TARGET_DIR="${API_TARGET_DIR:-/var/www/api}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"
source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"

RECOVERY_SERVICE_FILE="${SCRIPT_DIR}/../configs/systemd/softerr-recover-quiz-imports.service"
RECOVERY_TIMER_FILE="${SCRIPT_DIR}/../configs/systemd/softerr-recover-quiz-imports.timer"
for file in "${RECOVERY_SERVICE_FILE}" "${RECOVERY_TIMER_FILE}" /etc/softerr/email-worker.env; do
  if [[ ! -f "${file}" ]]; then
    echo "Quiz import recovery requirement is missing: ${file}" >&2
    exit 1
  fi
done
install -m 644 "${RECOVERY_SERVICE_FILE}" /etc/systemd/system/softerr-recover-quiz-imports.service
install -m 644 "${RECOVERY_TIMER_FILE}" /etc/systemd/system/softerr-recover-quiz-imports.timer
systemctl daemon-reload
systemctl enable --now softerr-recover-quiz-imports.timer

echo "Deploying API from: ${SOURCE_DIR}"
restart_api_fpm() {
  local routes_file=/etc/nginx/snippets/softerr-routes.conf
  local socket
  socket="$(sed -nE 's/^[[:space:]]*fastcgi_pass unix:([^;]+);/\1/p' "${routes_file}" | head -n 1)"
  if [[ ! "${socket}" =~ ^/run/php/php([0-9.]+)-fpm\.sock$ ]]; then
    echo "Could not identify the PHP-FPM service from ${routes_file}." >&2
    return 1
  fi
  systemctl restart "php${BASH_REMATCH[1]}-fpm.service"
}
verify_api_release() {
  restart_api_fpm || return 1
  verify_local_app_route /api/ api || return 1
  verify_local_app_route /api/auth/me auth-required || return 1
  verify_local_app_route /api/quiz/quizzes auth-required || return 1
  verify_local_app_route /api/media/images auth-required
}
if ! atomic_deploy_dir "${SOURCE_DIR}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}" verify_api_release; then
  restart_api_fpm || true
  exit 1
fi

echo "API deployed successfully."
echo "Source: ${SOURCE_DIR}"
echo "Target: ${TARGET_DIR}"
