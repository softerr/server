#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_php_fpm.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/apt_locks.sh"
source "${SCRIPT_DIR}/lib/api_env.sh"
load_api_env

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)." >&2
  exit 1
fi

wait_for_apt_locks
echo "Installing PHP runtime..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y php-fpm php-cli php-pgsql php-zip curl

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
  cat > "${API_ENV_FILE}" <<EOF
[www]
php_admin_value[memory_limit] = 256M
php_admin_value[post_max_size] = 48M
env[DB_HOST] = "$(escape_api_env_value "${API_DB_HOST}")"
env[DB_PORT] = "$(escape_api_env_value "${API_DB_PORT}")"
env[DB_NAME] = "$(escape_api_env_value "${API_DB_NAME}")"
env[DB_USER] = "$(escape_api_env_value "${API_DB_USER}")"
env[DB_PASSWORD] = "$(escape_api_env_value "${API_DB_PASSWORD}")"
env[APP_BASE_URL] = "$(escape_api_env_value "${API_APP_BASE_URL}")"
EOF

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

