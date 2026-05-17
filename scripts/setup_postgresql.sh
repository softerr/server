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

wait_for_apt_locks() {
  local timeout="${APT_LOCK_TIMEOUT_SECONDS:-300}"
  local waited=0
  local step=3

  apt_is_busy() {
    if pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1 || pgrep -x unattended-upgrade >/dev/null 2>&1; then
      return 0
    fi

    local lock_file
    for lock_file in /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock; do
      if [[ -e "${lock_file}" ]] && command -v fuser >/dev/null 2>&1 && fuser "${lock_file}" >/dev/null 2>&1; then
        return 0
      fi
    done
    return 1
  }

  while apt_is_busy; do
    if (( waited == 0 )); then
      echo "Waiting for apt/dpkg locks to be released..."
    fi
    sleep "${step}"
    waited=$((waited + step))
    if (( waited >= timeout )); then
      echo "Timed out waiting for apt/dpkg locks after ${timeout}s."
      exit 1
    fi
  done
}

if [[ -z "${POSTGRES_AUTH_API_PASSWORD:-}" ]]; then
  echo "POSTGRES_AUTH_API_PASSWORD is required."
  echo "Set it in server environment before running this script."
  exit 1
fi

if dpkg -s postgresql postgresql-contrib >/dev/null 2>&1; then
  echo "PostgreSQL packages are already installed."
else
  wait_for_apt_locks
  echo "Installing PostgreSQL..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y postgresql postgresql-contrib
fi

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
