#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_postgresql.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DB_NAME="${POSTGRES_DB:-app}"
DB_OWNER="${POSTGRES_OWNER:-postgres}"
SQL_FILE="${POSTGRES_SQL_FILE:-${REPO_ROOT}/configs/postgresql/init.sql}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "SQL file not found: ${SQL_FILE}"
  echo "Expected path: ../configs/postgresql/init.sql relative to this script."
  exit 1
fi

echo "Installing PostgreSQL..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-contrib

echo "Starting PostgreSQL service..."
systemctl enable --now postgresql

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "Creating database: ${DB_NAME}"
  sudo -u postgres createdb -O "${DB_OWNER}" "${DB_NAME}"
else
  echo "Database already exists: ${DB_NAME}"
fi

echo "Applying SQL file: ${SQL_FILE}"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${SQL_FILE}"

echo "Done."
echo "PostgreSQL is installed and database '${DB_NAME}' is initialized."
