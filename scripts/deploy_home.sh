#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/deploy_home.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREBUILT_DIST_DIR="${HOME_DIST_DIR:-${REMOTE_DIR:-/tmp/workflow-artifacts}/app/home/dist}"
TARGET_DIR="${HOME_TARGET_DIR:-/var/www/home}"
WEB_USER="${WEB_USER:-www-data}"
WEB_GROUP="${WEB_GROUP:-www-data}"

if [[ ! -f "${PREBUILT_DIST_DIR}/index.html" ]]; then
  echo "Prebuilt home artifacts not found: ${PREBUILT_DIST_DIR}" >&2
  exit 1
fi

source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"

# Certbot's existing renewal configuration may use /var/www/home as its
# webroot. Keep its challenge directory outside the replaceable app release.
install -d -o "${WEB_USER}" -g "${WEB_GROUP}" -m 755 /var/www/acme/.well-known/acme-challenge
if [[ -d "${TARGET_DIR}/.well-known" && ! -L "${TARGET_DIR}/.well-known" ]]; then
  cp -a -- "${TARGET_DIR}/.well-known/." /var/www/acme/.well-known/
fi

release_source="$(mktemp -d /var/www/.home-source.XXXXXXXX)"
trap 'rm -rf -- "${release_source}"' EXIT
cp -a -- "${PREBUILT_DIST_DIR}/." "${release_source}/"
if [[ -e "${release_source}/.well-known" || -L "${release_source}/.well-known" ]]; then
  echo "Home build must not contain .well-known; it is reserved for certificate challenges." >&2
  exit 1
fi
ln -s /var/www/acme/.well-known "${release_source}/.well-known"

echo "Deploying home to: ${TARGET_DIR}"
atomic_deploy_dir "${release_source}" "${TARGET_DIR}" "${WEB_USER}" "${WEB_GROUP}" \
  verify_local_app_route / file "${TARGET_DIR}/index.html"

echo "Home deployed successfully."
