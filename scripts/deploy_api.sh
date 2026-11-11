#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_api.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/app_registry.sh"
source "${SCRIPT_DIR}/lib/app_services.sh"
load_app_registry "${REPO_ROOT}"
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
for entrypoint in index auth media; do
  if [[ ! -f "${SOURCE_DIR}/${entrypoint}.php" ]]; then
    echo "Missing API entry file: ${SOURCE_DIR}/${entrypoint}.php" >&2
    exit 1
  fi
done
api_release="$(mktemp -d "${TMPDIR:-/tmp}/softerr-api-source.XXXXXXXX")"
cleanup_api_deploy() {
  local result=$?
  trap - EXIT
  rm -rf -- "${api_release}" || result=1
  exit "${result}"
}
trap cleanup_api_deploy EXIT
cp -a -- "${SOURCE_DIR}/." "${api_release}/"
# An artifact upload can retain files from an older app. Rebuild the app-facing
# part of the release solely from the current manifests.
rm -rf -- "${api_release}/apps"
for entrypoint_file in "${api_release}/"*.php; do
  [[ -f "${entrypoint_file}" ]] || continue
  case "${entrypoint_file##*/}" in
    index.php|auth.php|media.php|mail.php) ;;
    *) rm -f -- "${entrypoint_file}" ;;
  esac
done
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_HEALTH_ROUTES[$app]}" ]] && continue
  module_source="${REPO_ROOT}/${APP_SOURCES[$app]}/server"
  if [[ ! -d "${module_source}" ]]; then
    echo "Missing ${app} API module: ${module_source}" >&2
    exit 1
  fi
  if [[ ! -f "${module_source}/health.php" ]]; then
    echo "Missing ${app} API readiness check: ${module_source}/health.php" >&2
    exit 1
  fi
  if [[ ! -f "${module_source}/entrypoint.php" ]]; then
    echo "Missing ${app} API entry point: ${module_source}/entrypoint.php" >&2
    exit 1
  fi
  if [[ -n "${APP_DATABASES[$app]}" && ! -f "${module_source}/delete_user.php" ]]; then
    echo "Missing ${app} account cleanup hook: ${module_source}/delete_user.php" >&2
    exit 1
  fi
  install -d "${api_release}/apps/${app}"
  cp -a -- "${module_source}/." "${api_release}/apps/${app}/"
  cp -a -- "${module_source}/entrypoint.php" "${api_release}/${app}.php"
  rm -f -- "${api_release}/apps/${app}/schema.sql" "${api_release}/apps/${app}/media.sql" \
    "${api_release}/apps/${app}/nginx.conf" \
    "${api_release}/apps/${app}/entrypoint.php"
  rm -rf -- "${api_release}/apps/${app}/systemd"
done

TARGET_DIR="${API_TARGET_DIR:-/var/www/api}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"
source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"
source "${SCRIPT_DIR}/lib/apt_locks.sh"

# Check the schema of a component when this release changes its API code.
# An outage in an unchanged app must not roll back an unrelated API release.
verify_media_health=false
for file in media.php handlers/images.php handlers/audio.php \
  handlers/media_groups.php handlers/online_images.php lib/db.php lib/http.php; do
  if ! cmp -s -- "${api_release}/${file}" "${TARGET_DIR}/${file}"; then
    verify_media_health=true
    break
  fi
done
verify_app_health=()
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_HEALTH_ROUTES[$app]}" ]] && continue
  if [[ ! -d "${TARGET_DIR}/apps/${app}" ]] \
    || ! diff -qr -- "${api_release}/apps/${app}" "${TARGET_DIR}/apps/${app}" >/dev/null \
    || ! cmp -s -- "${api_release}/${app}.php" "${TARGET_DIR}/${app}.php" \
    || ! cmp -s -- "${api_release}/lib/db.php" "${TARGET_DIR}/lib/db.php" \
    || ! cmp -s -- "${api_release}/lib/http.php" "${TARGET_DIR}/lib/http.php"; then
    verify_app_health+=("${app}")
  fi
done

routes_file=/etc/nginx/snippets/softerr-routes.conf
socket="$(sed -nE 's/^[[:space:]]*fastcgi_pass unix:([^;]+);/\1/p' "${routes_file}" | head -n 1)"
if [[ ! "${socket}" =~ ^/run/php/php([0-9.]+)-fpm\.sock$ ]]; then
  echo "Could not identify the PHP-FPM service from ${routes_file}." >&2
  exit 1
fi
php_version="${BASH_REMATCH[1]}"
if ! "php${php_version}" -m | grep -Fxiq gd; then
  wait_for_apt_locks
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y "php${php_version}-gd"
fi

echo "Deploying API from: ${SOURCE_DIR}"
restart_api_fpm() {
  systemctl restart "php${php_version}-fpm.service"
}
verify_api_release() {
  restart_api_fpm || return 1
  verify_local_app_route /api/health/core api || return 1
  verify_local_app_route /api/auth/me auth-required || return 1
  verify_local_app_route /api/media/images auth-required || return 1
  if [[ "${verify_media_health}" == true ]]; then
    verify_local_app_route /api/health/media api || return 1
  fi
  local app
  for app in "${WEB_APPS[@]}"; do
    [[ -z "${APP_HEALTH_ROUTES[$app]}" ]] && continue
    verify_local_app_route "${APP_HEALTH_ROUTES[$app]}" auth-required || return 1
  done
  for app in "${verify_app_health[@]}"; do
    verify_local_app_route "/api/health/${app}" api || return 1
  done
}
install -d -m 755 /usr/local/lib/softerr /var/lib/softerr
install -d -o postgres -g www-data -m 2770 /var/lib/softerr/media \
  /var/lib/softerr/media/images /var/lib/softerr/media/thumbnails \
  /var/lib/softerr/media/audio
install -m 755 "${SCRIPT_DIR}/backup_postgresql.sh" \
  /usr/local/lib/softerr/backup_postgresql.sh
install -m 644 "${SCRIPT_DIR}/lib/app_registry.sh" \
  /usr/local/lib/softerr/app_registry.sh
install -m 644 "${SCRIPT_DIR}/lib/verify_media_archive.py" \
  /usr/local/lib/softerr/verify_media_archive.py
if ! atomic_deploy_dir "${api_release}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}" verify_api_release; then
  restart_api_fpm || true
  exit 1
fi
install_app_registry /etc/softerr/apps.tsv
install_app_services "${REPO_ROOT}"
echo "API deployed successfully."
echo "Source: ${SOURCE_DIR}"
echo "Target: ${TARGET_DIR}"
