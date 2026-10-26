#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_api_runtime.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/apt_locks.sh"
source "${SCRIPT_DIR}/lib/tls_certificate.sh"
EMAIL_SERVICE_FILE="${REPO_ROOT}/configs/systemd/softerr-send-email.service"
EMAIL_TIMER_FILE="${REPO_ROOT}/configs/systemd/softerr-send-email.timer"

: "${API_DB_PASSWORD:?API_DB_PASSWORD is required}"
: "${API_APP_BASE_URL:?API_APP_BASE_URL is required}"

if [[ "${API_APP_BASE_URL}" == https://* ]]; then
  tls_certificate_paths "${API_APP_BASE_URL}" || exit 1
elif [[ ! "${API_APP_BASE_URL}" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]]; then
  echo "API_APP_BASE_URL must use HTTPS for a public host; HTTP is allowed only for localhost or 127.0.0.1." >&2
  exit 1
fi

if [[ ! -f "${EMAIL_SERVICE_FILE}" || ! -f "${EMAIL_TIMER_FILE}" ]]; then
  echo "Email worker unit files not found." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)." >&2
  exit 1
fi

wait_for_apt_locks
echo "Installing PHP runtime..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y php-fpm php-cli php-pgsql curl

echo "Discovering php-fpm service..."
PHP_FPM_SERVICE=""
while IFS= read -r unit_line; do
  unit_name="${unit_line%% *}"
  if [[ "${unit_name}" =~ ^php[0-9.]+-fpm\.service$ ]]; then
    PHP_FPM_SERVICE="${unit_name}"
    break
  fi
done < <(systemctl list-unit-files --type=service --no-legend)
if [[ -z "${PHP_FPM_SERVICE}" ]]; then
  PHP_FPM_SERVICE="php-fpm.service"
fi

systemctl enable --now "${PHP_FPM_SERVICE}" || true

PHP_SOCK="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' -print -quit || true)"
if [[ -z "${PHP_SOCK}" ]]; then
  echo "Could not find php-fpm socket in /run/php." >&2
  exit 1
fi

PHP_VERSION=""
if [[ "${PHP_FPM_SERVICE}" =~ ^php([0-9.]+)-fpm\.service$ ]]; then
  PHP_VERSION="${BASH_REMATCH[1]}"
fi
if [[ -z "${PHP_VERSION}" && "${PHP_SOCK}" =~ php([0-9.]+)-fpm\.sock$ ]]; then
  PHP_VERSION="${BASH_REMATCH[1]}"
fi

if [[ -n "${PHP_VERSION}" ]]; then
  FPM_POOL_DIR="/etc/php/${PHP_VERSION}/fpm/pool.d"
  API_ENV_FILE="${FPM_POOL_DIR}/zz-softerr-api-env.conf"
  API_DB_HOST="${API_DB_HOST:-127.0.0.1}"
  API_DB_PORT="${API_DB_PORT:-5432}"
  API_DB_NAME="${API_DB_NAME:-auth}"
  API_DB_USER="${API_DB_USER:-auth_api}"
  API_DB_PASSWORD="${API_DB_PASSWORD:-}"
  API_MAIL_FROM="${API_MAIL_FROM:-}"
  API_APP_BASE_URL="${API_APP_BASE_URL:-}"
  API_SMTP_HOST="${API_SMTP_HOST:-}"
  API_SMTP_PORT="${API_SMTP_PORT:-}"
  API_SMTP_ENCRYPTION="${API_SMTP_ENCRYPTION:-}"
  API_SMTP_USERNAME="${API_SMTP_USERNAME:-}"
  API_SMTP_PASSWORD="${API_SMTP_PASSWORD:-}"

  esc() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '%s' "$value"
  }

  cat > "${API_ENV_FILE}" <<EOF
[www]
env[DB_HOST] = "$(esc "${API_DB_HOST}")"
env[DB_PORT] = "$(esc "${API_DB_PORT}")"
env[DB_NAME] = "$(esc "${API_DB_NAME}")"
env[DB_USER] = "$(esc "${API_DB_USER}")"
env[DB_PASSWORD] = "$(esc "${API_DB_PASSWORD}")"
env[APP_BASE_URL] = "$(esc "${API_APP_BASE_URL}")"
EOF

  append_optional_env() {
    local key="$1"
    local value="$2"
    if [[ -n "${value}" ]]; then
      echo "env[${key}] = \"$(esc "${value}")\"" >> "${API_ENV_FILE}"
    fi
  }

  append_optional_env "MAIL_FROM" "${API_MAIL_FROM}"
  append_optional_env "SMTP_HOST" "${API_SMTP_HOST}"
  append_optional_env "SMTP_PORT" "${API_SMTP_PORT}"
  append_optional_env "SMTP_ENCRYPTION" "${API_SMTP_ENCRYPTION}"
  append_optional_env "SMTP_USERNAME" "${API_SMTP_USERNAME}"
  append_optional_env "SMTP_PASSWORD" "${API_SMTP_PASSWORD}"
  chmod 640 "${API_ENV_FILE}"
  chown root:root "${API_ENV_FILE}"

  mapfile -t conflicting_env_files < <(find "${FPM_POOL_DIR}" -maxdepth 1 -name '*.conf' \
    ! -path "${API_ENV_FILE}" -exec grep -lE '^[[:space:]]*env\[DB_PASSWORD\][[:space:]]*=' {} +)
  if (( ${#conflicting_env_files[@]} > 0 )); then
    printf 'Conflicting php-fpm DB_PASSWORD setting in: %s\n' "${conflicting_env_files[@]}" >&2
    exit 1
  fi
  echo "Configured API DB env in php-fpm pool: ${API_ENV_FILE}"
  systemctl restart "${PHP_FPM_SERVICE}"
else
  echo "Could not determine PHP version for php-fpm env file generation."
  echo "Detected socket: ${PHP_SOCK}"
  echo "Detected service: ${PHP_FPM_SERVICE}"
  exit 1
fi

echo "Configuring email worker..."
install -d -m 755 /etc/softerr
cat > /etc/softerr/email-worker.env <<EOF
DB_HOST="$(esc "${API_DB_HOST}")"
DB_PORT="$(esc "${API_DB_PORT}")"
DB_NAME="$(esc "${API_DB_NAME}")"
DB_USER="$(esc "${API_DB_USER}")"
DB_PASSWORD="$(esc "${API_DB_PASSWORD}")"
APP_BASE_URL="$(esc "${API_APP_BASE_URL}")"
MAIL_FROM="$(esc "${API_MAIL_FROM}")"
SMTP_HOST="$(esc "${API_SMTP_HOST}")"
SMTP_PORT="$(esc "${API_SMTP_PORT}")"
SMTP_ENCRYPTION="$(esc "${API_SMTP_ENCRYPTION}")"
SMTP_USERNAME="$(esc "${API_SMTP_USERNAME}")"
SMTP_PASSWORD="$(esc "${API_SMTP_PASSWORD}")"
EOF
chown root:www-data /etc/softerr/email-worker.env
chmod 640 /etc/softerr/email-worker.env
install -m 644 "${EMAIL_SERVICE_FILE}" /etc/systemd/system/softerr-send-email.service
install -m 644 "${EMAIL_TIMER_FILE}" /etc/systemd/system/softerr-send-email.timer
systemctl daemon-reload
systemctl enable --now softerr-send-email.timer

