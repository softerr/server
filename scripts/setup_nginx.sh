#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash setup_nginx.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/api_env.sh"
source "${SCRIPT_DIR}/lib/apt_locks.sh"
source "${SCRIPT_DIR}/lib/app_registry.sh"
load_app_registry "${REPO_ROOT}"
CONFIG_TEMPLATE="${NGINX_CONFIG_TEMPLATE:-${REPO_ROOT}/configs/nginx/softerr.conf.template}"
TLS_CONFIG_TEMPLATE="${NGINX_TLS_CONFIG_TEMPLATE:-${REPO_ROOT}/configs/nginx/softerr-tls.conf.template}"
ROUTES_TEMPLATE="${NGINX_ROUTES_TEMPLATE:-${REPO_ROOT}/configs/nginx/softerr-routes.conf.template}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

validate_api_app_base_url "${API_APP_BASE_URL:-}" || exit 1
if [[ "${API_APP_BASE_URL}" == https://* ]]; then
  CONFIG_TEMPLATE="${TLS_CONFIG_TEMPLATE}"
  tls_certificate_valid "${TLS_HOST}" "${TLS_CERT_FILE}" "${TLS_KEY_FILE}" || exit 1
else
  TLS_ORIGIN=""
  TLS_CERT_FILE=""
  TLS_KEY_FILE=""
fi

if [[ ! -f "${CONFIG_TEMPLATE}" || ! -f "${ROUTES_TEMPLATE}" ]]; then
  echo "Nginx config or routes template not found."
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  wait_for_apt_locks
  echo "Installing nginx..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y nginx
fi

echo "Creating web directories..."
mkdir -p /var/www/api
for app in "${WEB_APPS[@]}"; do
  target="${APP_TARGETS[$app]}"
  mkdir -p "${target}"
  if [[ ! -f "${target}/index.html" ]]; then
    cat > "${target}/index.html" <<EOF
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${APP_TITLES[$app]}</title></head>
<body><h1>${APP_TITLES[$app]} page is working</h1></body></html>
EOF
  fi
done
chown -R www-data:www-data /var/www/api "${APP_TARGETS[@]}"
find /var/www/api "${APP_TARGETS[@]}" -type d -exec chmod 755 {} \;

if [[ ! -f /var/www/api/index.php ]]; then
  cat > /var/www/api/index.php <<'EOF'
<?php
header('Content-Type: application/json');
http_response_code(503);
echo json_encode(['status' => 'unavailable', 'error' => 'API is not deployed']);
EOF
fi

echo "Discovering php-fpm socket..."
PHP_SOCK="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' -print -quit || true)"
if [[ -z "${PHP_SOCK}" ]]; then
  echo "Could not find php-fpm socket in /run/php. Run setup_php_fpm.sh first." >&2
  exit 1
fi

echo "Staging nginx site config..."
install -d -m 755 /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
nginx_stage="$(mktemp -d /etc/nginx/.softerr-stage.XXXXXXXX)"
nginx_installed=false
nginx_committed=false
nginx_was_active=false
nginx_preserve_stage=false
routes_next=""
site_next=""
nginx_test_config=""
nginx_paths=(
  /etc/nginx/snippets/softerr-routes.conf
  /etc/nginx/sites-available/softerr
  /etc/nginx/sites-enabled/default
  /etc/nginx/sites-enabled/softerr-bootstrap
  /etc/nginx/sites-enabled/softerr
)

restore_nginx_config() {
  local index path result=0
  for index in "${!nginx_paths[@]}"; do
    path="${nginx_paths[index]}"
    rm -f -- "${path}" || result=1
    if [[ -e "${nginx_stage}/backup/${index}" || -L "${nginx_stage}/backup/${index}" ]]; then
      cp -a -- "${nginx_stage}/backup/${index}" "${path}" || result=1
    fi
  done
  return "${result}"
}

cleanup_nginx_stage() {
  local result=$?
  trap - EXIT HUP INT TERM
  if [[ "${nginx_installed}" == true && "${nginx_committed}" != true ]]; then
    echo "Nginx update failed; restoring the previous configuration." >&2
    if ! restore_nginx_config || ! nginx -t; then
      echo "Could not fully restore the previous Nginx configuration." >&2
      nginx_preserve_stage=true
      result=1
    elif [[ "${nginx_was_active}" == true ]] && ! systemctl reload nginx; then
      echo "Could not reload the restored Nginx configuration." >&2
      nginx_preserve_stage=true
      result=1
    fi
  fi
  [[ -z "${routes_next}" ]] || rm -f -- "${routes_next}" || result=1
  [[ -z "${site_next}" ]] || rm -f -- "${site_next}" || result=1
  [[ -z "${nginx_test_config}" ]] || rm -f -- "${nginx_test_config}" || result=1
  if [[ "${nginx_preserve_stage}" == true ]]; then
    echo "Nginx config backups remain at ${nginx_stage}/backup for manual recovery." >&2
  else
    rm -rf -- "${nginx_stage}" || result=1
  fi
  exit "${result}"
}
trap cleanup_nginx_stage EXIT
trap 'exit 1' HUP INT TERM

if [[ "$(grep -Fxc '__WEB_APP_ROUTES__' "${ROUTES_TEMPLATE}")" != 1 \
  || "$(grep -Fxc '__APP_API_ROUTES__' "${ROUTES_TEMPLATE}")" != 1 ]]; then
  echo "Nginx routes template must contain one marker for each app route section." >&2
  exit 1
fi
render_web_app_routes > "${nginx_stage}/web-routes.conf"
render_app_api_routes "${REPO_ROOT}" > "${nginx_stage}/app-api-routes.conf"
while IFS= read -r line; do
  case "${line}" in
    __WEB_APP_ROUTES__) cat "${nginx_stage}/web-routes.conf" ;;
    __APP_API_ROUTES__) cat "${nginx_stage}/app-api-routes.conf" ;;
    *) printf '%s\n' "${line}" ;;
  esac
done < "${ROUTES_TEMPLATE}" > "${nginx_stage}/routes.conf"
sed -i "s|__PHP_FPM_SOCK__|${PHP_SOCK}|g" "${nginx_stage}/routes.conf"
sed \
  -e "s|__TLS_ORIGIN__|${TLS_ORIGIN}|g" \
  -e "s|__TLS_CERT_FILE__|${TLS_CERT_FILE}|g" \
  -e "s|__TLS_KEY_FILE__|${TLS_KEY_FILE}|g" \
  "${CONFIG_TEMPLATE}" > "${nginx_stage}/site.conf"

if ! grep -Fq 'include /etc/nginx/snippets/softerr-routes.conf;' "${nginx_stage}/site.conf"; then
  echo "Staged Nginx site does not include the Softerr routes snippet." >&2
  exit 1
fi
sed "s|include /etc/nginx/snippets/softerr-routes.conf;|include ${nginx_stage}/routes.conf;|g" \
  "${nginx_stage}/site.conf" > "${nginx_stage}/test-site.conf"
# Nginx resolves relative includes from the main config's directory. Keep the
# validation entry file in /etc/nginx so snippets/fastcgi-php.conf resolves.
nginx_test_config="$(mktemp /etc/nginx/.softerr-validate.XXXXXXXX.conf)"
{
  echo 'events {}'
  echo 'http {'
  cat "${nginx_stage}/test-site.conf"
  echo '}'
} > "${nginx_test_config}"

echo "Validating staged nginx configuration..."
nginx -t -c "${nginx_test_config}"

mkdir -p -- "${nginx_stage}/backup"
for index in "${!nginx_paths[@]}"; do
  path="${nginx_paths[index]}"
  if [[ -e "${path}" || -L "${path}" ]]; then
    cp -a -- "${path}" "${nginx_stage}/backup/${index}"
  fi
done
if systemctl is-active --quiet nginx; then
  nginx_was_active=true
fi

nginx_installed=true
routes_next="$(mktemp /etc/nginx/snippets/.softerr-routes.next.XXXXXXXX)"
install -m 644 "${nginx_stage}/routes.conf" "${routes_next}"
mv -f -- "${routes_next}" /etc/nginx/snippets/softerr-routes.conf
site_next="$(mktemp /etc/nginx/sites-available/.softerr.next.XXXXXXXX)"
install -m 644 "${nginx_stage}/site.conf" "${site_next}"
mv -f -- "${site_next}" /etc/nginx/sites-available/softerr
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/softerr-bootstrap
ln -sfn /etc/nginx/sites-available/softerr /etc/nginx/sites-enabled/softerr

echo "Validating full nginx configuration..."
nginx -t

echo "Activating nginx configuration..."
systemctl enable nginx
if [[ "${nginx_was_active}" == true ]]; then
  systemctl reload nginx
else
  systemctl start nginx
fi
nginx_committed=true

echo "Done."
echo "Mapped routes:"
for app in "${WEB_APPS[@]}"; do echo "  ${APP_ROUTES[$app]} -> ${APP_TARGETS[$app]}"; done
echo "  /api   -> /var/www/api (PHP)"
