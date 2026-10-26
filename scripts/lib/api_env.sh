#!/usr/bin/env bash

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/tls_certificate.sh"

validate_api_app_base_url() {
  local origin="${1:-}"
  if [[ "${origin}" == https://* ]]; then
    tls_certificate_paths "${origin}" || return 1
  elif [[ ! "${origin}" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]]; then
    echo "API_APP_BASE_URL must use HTTPS for a public host; HTTP is allowed only for localhost or 127.0.0.1." >&2
    return 1
  fi
}

load_api_env() {
  : "${API_DB_PASSWORD:?API_DB_PASSWORD is required}"
  : "${API_APP_BASE_URL:?API_APP_BASE_URL is required}"

  validate_api_app_base_url "${API_APP_BASE_URL}" || return 1

  API_DB_HOST="${API_DB_HOST:-127.0.0.1}"
  API_DB_PORT="${API_DB_PORT:-5432}"
  API_DB_NAME="${API_DB_NAME:-auth}"
  API_DB_USER="${API_DB_USER:-auth_api}"
}

load_mail_env() {
  API_MAIL_FROM="${API_MAIL_FROM:-}"
  API_SMTP_HOST="${API_SMTP_HOST:-}"
  API_SMTP_PORT="${API_SMTP_PORT:-}"
  API_SMTP_ENCRYPTION="${API_SMTP_ENCRYPTION:-}"
  API_SMTP_USERNAME="${API_SMTP_USERNAME:-}"
  API_SMTP_PASSWORD="${API_SMTP_PASSWORD:-}"
}

escape_api_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}
