#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_server.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/tls_certificate.sh"
BOOTSTRAP_CONFIG="${REPO_ROOT}/configs/nginx/softerr-bootstrap.conf"

: "${POSTGRES_AUTH_API_PASSWORD:?POSTGRES_AUTH_API_PASSWORD is required}"
: "${API_DB_PASSWORD:?API_DB_PASSWORD is required}"
: "${TLS_CONTACT_EMAIL:?TLS_CONTACT_EMAIL is required for unattended certificate setup}"
if [[ "${API_DB_PASSWORD}" != "${POSTGRES_AUTH_API_PASSWORD}" ]]; then
  echo "API_DB_PASSWORD and POSTGRES_AUTH_API_PASSWORD must match." >&2
  exit 1
fi

tls_certificate_paths "${API_APP_BASE_URL:-}" || exit 1
if [[ ! -f "${BOOTSTRAP_CONFIG}" ]]; then
  echo "Missing Nginx bootstrap config: ${BOOTSTRAP_CONFIG}" >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script requires Debian or Ubuntu with apt-get." >&2
  exit 1
fi

public_host="${TLS_HOST}"
cert_file="${TLS_CERT_FILE}"
key_file="${TLS_KEY_FILE}"

# Certbot's webroot challenge needs an HTTP site before the final TLS site exists.
bootstrap_installed=false
if [[ ! -r "${cert_file}" || ! -r "${key_file}" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y nginx curl
  install -d -m 755 /var/www/home /etc/nginx/sites-available /etc/nginx/sites-enabled
  install -m 644 "${BOOTSTRAP_CONFIG}" /etc/nginx/sites-available/softerr-bootstrap
  rm -f /etc/nginx/sites-enabled/default
  rm -f /etc/nginx/sites-enabled/softerr
  ln -sfn /etc/nginx/sites-available/softerr-bootstrap /etc/nginx/sites-enabled/softerr-bootstrap
  nginx -t
  bootstrap_installed=true
fi
systemctl enable --now nginx
if [[ "${bootstrap_installed}" == true ]]; then
  systemctl reload nginx
fi
if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y curl
fi

if tls_certificate_valid "${public_host}" "${cert_file}" "${key_file}" >/dev/null 2>&1 \
  && [[ -x /etc/letsencrypt/renewal-hooks/deploy/softerr-reload-nginx.sh ]] \
  && systemctl is-active --quiet snap.certbot.renew.timer; then
  echo "Reusing the existing certificate and renewal timer for ${public_host}."
else
  bash "${SCRIPT_DIR}/setup_tls_certificate.sh" "${public_host}"
fi

PROVISION_COMPONENTS=all bash "${SCRIPT_DIR}/provision.sh"

systemctl is-active --quiet nginx
systemctl is-active --quiet postgresql
systemctl is-active --quiet softerr-send-email.timer
systemctl is-active --quiet softerr-prune-user-tokens.timer
curl -fsS --noproxy '*' --connect-timeout 5 --max-time 15 \
  --connect-to "${public_host}:443:127.0.0.1:443" "${API_APP_BASE_URL%/}/api/" >/dev/null
curl -fsS --noproxy '*' --connect-timeout 5 --max-time 15 \
  --connect-to "${public_host}:443:127.0.0.1:443" "${API_APP_BASE_URL%/}/quiz/" >/dev/null

echo "First-time setup is complete: ${API_APP_BASE_URL%/}"
