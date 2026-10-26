#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_server.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/tls_certificate.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"
BOOTSTRAP_CONFIG="${REPO_ROOT}/configs/nginx/softerr-bootstrap.conf"

: "${API_DB_PASSWORD:?API_DB_PASSWORD is required}"
: "${TLS_CONTACT_EMAIL:?TLS_CONTACT_EMAIL is required for unattended certificate setup}"

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

PROVISION_COMPONENTS=postgresql bash "${SCRIPT_DIR}/provision.sh"
if ! PGPASSWORD="${API_DB_PASSWORD}" PGCONNECT_TIMEOUT=5 psql -X -v ON_ERROR_STOP=1 \
  -h "${API_DB_HOST:-127.0.0.1}" -p "${API_DB_PORT:-5432}" \
  -U "${API_DB_USER:-auth_api}" -d "${API_DB_NAME:-auth}" \
  -Atqc 'SELECT 1' >/dev/null; then
  echo "PostgreSQL is not reachable with the API credentials." >&2
  exit 1
fi
if ! PGPASSWORD="${API_DB_PASSWORD}" PGCONNECT_TIMEOUT=5 psql -X -v ON_ERROR_STOP=1 \
  -h "${API_DB_HOST:-127.0.0.1}" -p "${API_DB_PORT:-5432}" \
  -U "${API_DB_USER:-auth_api}" -d quiz \
  -Atqc 'SELECT 1 FROM public.quiz q, public."user" u LIMIT 0' >/dev/null; then
  echo "Quiz database is not reachable with the API credentials." >&2
  exit 1
fi
PROVISION_COMPONENTS=php-fpm,email-worker,nginx,api,home,quiz bash "${SCRIPT_DIR}/provision.sh"

systemctl is-active --quiet nginx
systemctl is-active --quiet postgresql
systemctl is-active --quiet softerr-send-email.timer
systemctl is-active --quiet softerr-prune-user-tokens.timer
systemctl is-active --quiet softerr-backup-postgresql.timer

verify_local_app_route /api/ api
verify_local_app_route /api/auth/me auth-required
verify_local_app_route /api/quiz/quizzes auth-required
verify_local_app_route / file /var/www/home/index.html
verify_local_app_route /quiz/ file /var/www/quiz/index.html

echo "First-time setup is complete: ${API_APP_BASE_URL%/}"
