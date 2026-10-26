#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_email_worker.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/api_env.sh"
load_api_env
load_mail_env

EMAIL_SERVICE_FILE="${REPO_ROOT}/configs/systemd/softerr-send-email.service"
EMAIL_TIMER_FILE="${REPO_ROOT}/configs/systemd/softerr-send-email.timer"
if [[ ! -f "${EMAIL_SERVICE_FILE}" || ! -f "${EMAIL_TIMER_FILE}" ]]; then
  echo "Email worker unit files not found." >&2
  exit 1
fi
if ! command -v php >/dev/null 2>&1; then
  echo "PHP CLI is required. Run setup_php_fpm.sh first." >&2
  exit 1
fi

echo "Configuring email worker..."
install -d -m 755 /etc/softerr
cat > /etc/softerr/email-worker.env <<EOF
DB_HOST="$(escape_api_env_value "${API_DB_HOST}")"
DB_PORT="$(escape_api_env_value "${API_DB_PORT}")"
DB_NAME="$(escape_api_env_value "${API_DB_NAME}")"
DB_USER="$(escape_api_env_value "${API_DB_USER}")"
DB_PASSWORD="$(escape_api_env_value "${API_DB_PASSWORD}")"
APP_BASE_URL="$(escape_api_env_value "${API_APP_BASE_URL}")"
MAIL_FROM="$(escape_api_env_value "${API_MAIL_FROM}")"
SMTP_HOST="$(escape_api_env_value "${API_SMTP_HOST}")"
SMTP_PORT="$(escape_api_env_value "${API_SMTP_PORT}")"
SMTP_ENCRYPTION="$(escape_api_env_value "${API_SMTP_ENCRYPTION}")"
SMTP_USERNAME="$(escape_api_env_value "${API_SMTP_USERNAME}")"
SMTP_PASSWORD="$(escape_api_env_value "${API_SMTP_PASSWORD}")"
EOF
chown root:www-data /etc/softerr/email-worker.env
chmod 640 /etc/softerr/email-worker.env
install -m 644 "${EMAIL_SERVICE_FILE}" /etc/systemd/system/softerr-send-email.service
install -m 644 "${EMAIL_TIMER_FILE}" /etc/systemd/system/softerr-send-email.timer
systemctl daemon-reload
systemctl enable --now softerr-send-email.timer

