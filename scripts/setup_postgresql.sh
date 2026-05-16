#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_postgresql.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
INIT_SQL_FILE="${REPO_ROOT}/configs/postgresql/init.sql"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

if [[ ! -f "${INIT_SQL_FILE}" ]]; then
  echo "PostgreSQL init SQL file not found: ${INIT_SQL_FILE}"
  echo "Expected path: ../configs/postgresql/init.sql relative to this script."
  exit 1
fi

if [[ -z "${POSTGRES_AUTH_API_PASSWORD:-}" ]]; then
  echo "POSTGRES_AUTH_API_PASSWORD is required."
  echo "Set it in server environment before running this script."
  exit 1
fi

echo "Installing PostgreSQL..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-contrib

echo "Starting PostgreSQL service..."
systemctl enable --now postgresql

echo "Applying PostgreSQL init SQL: ${INIT_SQL_FILE}"
sudo -u postgres psql \
  -v ON_ERROR_STOP=1 \
  -v auth_api_password="${POSTGRES_AUTH_API_PASSWORD}" \
  -d postgres \
  < "${INIT_SQL_FILE}"

echo "Done."
echo "PostgreSQL is installed and databases are initialized from ${INIT_SQL_FILE}."
