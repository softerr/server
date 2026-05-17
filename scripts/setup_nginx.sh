#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash setup_nginx.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CONFIG_TEMPLATE="${NGINX_CONFIG_TEMPLATE:-${REPO_ROOT}/configs/nginx/softerr.conf.template}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

if [[ ! -f "${CONFIG_TEMPLATE}" ]]; then
  echo "Nginx config template not found: ${CONFIG_TEMPLATE}"
  echo "Expected template path: ../configs/nginx/softerr.conf.template relative to this script."
  exit 1
fi

echo "Installing nginx and php-fpm..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx php-fpm php-pgsql

echo "Creating web directories..."
mkdir -p /var/www/home /var/www/quiz /var/www/api
chown -R www-data:www-data /var/www/home /var/www/quiz /var/www/api
find /var/www/home /var/www/quiz /var/www/api -type d -exec chmod 755 {} \;

if [[ ! -f /var/www/home/index.html ]]; then
  cat > /var/www/home/index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Home</title>
  </head>
  <body>
    <h1>Home page is working</h1>
  </body>
</html>
EOF
fi

if [[ ! -f /var/www/quiz/index.html ]]; then
  cat > /var/www/quiz/index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Quiz</title>
  </head>
  <body>
    <h1>Quiz page is working</h1>
  </body>
</html>
EOF
fi

if [[ ! -f /var/www/api/index.php ]]; then
  cat > /var/www/api/index.php <<'EOF'
<?php
header('Content-Type: application/json');
echo json_encode(['status' => 'ok', 'message' => 'API is working']);
EOF
fi

echo "Discovering php-fpm socket..."
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
  echo "Could not find php-fpm socket in /run/php."
  echo "Check php-fpm service status and set fastcgi_pass manually."
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
  API_ENV_FILE="/etc/php/${PHP_VERSION}/fpm/pool.d/zz-softerr-api-env.conf"
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

  if [[ -z "${API_DB_PASSWORD}" ]]; then
    echo "API_DB_PASSWORD is required but not set."
    echo "Set GitHub secret API_DB_PASSWORD and re-run Setup Nginx workflow."
    exit 1
  fi

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
EOF
  if [[ -n "${API_MAIL_FROM}" ]]; then
    echo "env[MAIL_FROM] = \"$(esc "${API_MAIL_FROM}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_APP_BASE_URL}" ]]; then
    echo "env[APP_BASE_URL] = \"$(esc "${API_APP_BASE_URL}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_SMTP_HOST}" ]]; then
    echo "env[SMTP_HOST] = \"$(esc "${API_SMTP_HOST}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_SMTP_PORT}" ]]; then
    echo "env[SMTP_PORT] = \"$(esc "${API_SMTP_PORT}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_SMTP_ENCRYPTION}" ]]; then
    echo "env[SMTP_ENCRYPTION] = \"$(esc "${API_SMTP_ENCRYPTION}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_SMTP_USERNAME}" ]]; then
    echo "env[SMTP_USERNAME] = \"$(esc "${API_SMTP_USERNAME}")\"" >> "${API_ENV_FILE}"
  fi
  if [[ -n "${API_SMTP_PASSWORD}" ]]; then
    echo "env[SMTP_PASSWORD] = \"$(esc "${API_SMTP_PASSWORD}")\"" >> "${API_ENV_FILE}"
  fi
  chmod 640 "${API_ENV_FILE}"
  chown root:root "${API_ENV_FILE}"
  echo "Configured API DB env in php-fpm pool: ${API_ENV_FILE}"
  systemctl restart "${PHP_FPM_SERVICE}"
else
  echo "Could not determine PHP version for php-fpm env file generation."
  echo "Detected socket: ${PHP_SOCK}"
  echo "Detected service: ${PHP_FPM_SERVICE}"
  exit 1
fi

echo "Writing nginx site config..."
sed "s|__PHP_FPM_SOCK__|${PHP_SOCK}|g" "${CONFIG_TEMPLATE}" > /etc/nginx/sites-available/softerr

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/softerr /etc/nginx/sites-enabled/softerr

echo "Validating nginx configuration..."
nginx -t

echo "Restarting services..."
systemctl enable nginx
systemctl restart nginx

echo "Done."
echo "Mapped routes:"
echo "  /      -> /var/www/home"
echo "  /quiz  -> /var/www/quiz"
echo "  /api   -> /var/www/api (PHP)"
