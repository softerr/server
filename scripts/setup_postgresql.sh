#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_postgresql.sh)."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
INIT_SQL_FILE="${REPO_ROOT}/configs/postgresql/init.sql"
PRUNE_SQL_FILE="${REPO_ROOT}/configs/postgresql/prune_user_tokens.sql"
PRUNE_SERVICE_FILE="${REPO_ROOT}/configs/systemd/softerr-prune-user-tokens.service"
PRUNE_TIMER_FILE="${REPO_ROOT}/configs/systemd/softerr-prune-user-tokens.timer"
BACKUP_SCRIPT_FILE="${SCRIPT_DIR}/backup_postgresql.sh"
BACKUP_SERVICE_FILE="${REPO_ROOT}/configs/systemd/softerr-backup-postgresql.service"
BACKUP_TIMER_FILE="${REPO_ROOT}/configs/systemd/softerr-backup-postgresql.timer"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

if [[ ! -f "${INIT_SQL_FILE}" ]]; then
  echo "PostgreSQL init SQL file not found: ${INIT_SQL_FILE}"
  echo "Expected path: ../configs/postgresql/init.sql relative to this script."
  exit 1
fi

for config_file in "${PRUNE_SQL_FILE}" "${PRUNE_SERVICE_FILE}" "${PRUNE_TIMER_FILE}" \
  "${BACKUP_SCRIPT_FILE}" "${BACKUP_SERVICE_FILE}" "${BACKUP_TIMER_FILE}"; do
  if [[ ! -f "${config_file}" ]]; then
    echo "Required PostgreSQL setup file not found: ${config_file}"
    exit 1
  fi
done

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

if [[ -z "${API_DB_PASSWORD:-}" ]]; then
  echo "API_DB_PASSWORD is required."
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
  -v auth_api_password="${API_DB_PASSWORD}" \
  -d postgres \
  < "${INIT_SQL_FILE}"

echo "Pruning expired verification tokens..."
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d auth < "${PRUNE_SQL_FILE}"

echo "Installing expired-token cleanup timer..."
install -d -m 755 /etc/softerr
install -m 644 "${PRUNE_SQL_FILE}" /etc/softerr/prune_user_tokens.sql
install -m 644 "${PRUNE_SERVICE_FILE}" /etc/systemd/system/softerr-prune-user-tokens.service
install -m 644 "${PRUNE_TIMER_FILE}" /etc/systemd/system/softerr-prune-user-tokens.timer
systemctl daemon-reload
systemctl enable --now softerr-prune-user-tokens.timer

echo "Installing verified database backup timer..."
install -d -m 755 /usr/local/lib/softerr
install -d -o postgres -g postgres -m 700 /var/backups/softerr
install -m 755 "${BACKUP_SCRIPT_FILE}" /usr/local/lib/softerr/backup_postgresql.sh
install -m 644 "${BACKUP_SERVICE_FILE}" /etc/systemd/system/softerr-backup-postgresql.service
install -m 644 "${BACKUP_TIMER_FILE}" /etc/systemd/system/softerr-backup-postgresql.timer
systemctl daemon-reload
systemctl start softerr-backup-postgresql.service
systemctl enable --now softerr-backup-postgresql.timer

echo "Done."
echo "PostgreSQL is installed and databases are initialized from ${INIT_SQL_FILE}."
