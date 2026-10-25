#!/usr/bin/env bash

set -euo pipefail

if [[ "$(id -un)" != postgres ]]; then
  echo "Run this script as the postgres user." >&2
  exit 1
fi

BACKUP_DIR=/var/backups/softerr
DB_NAME=auth
RETENTION_DAYS=30

umask 077
mkdir -p -- "${BACKUP_DIR}"
exec 9> "${BACKUP_DIR}/.backup.lock"
if ! flock -n 9; then
  echo "A database backup is already running." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$(mktemp -- "${BACKUP_DIR}/.${DB_NAME}-${stamp}.XXXXXXXX.partial")"
partial_name="${partial##*/}"
archive="${BACKUP_DIR}/${partial_name#.}"
archive="${archive%.partial}.dump"
restore_db="softerr_restore_check_$(date -u +%s)_$$"
restore_created=false

cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${restore_created}" == true ]]; then
    dropdb --if-exists -- "${restore_db}" || result=1
  fi
  rm -f -- "${partial}"
  exit "${result}"
}
trap cleanup EXIT

echo "Backing up ${DB_NAME}..."
pg_dump --format=custom --dbname="${DB_NAME}" --file="${partial}"

echo "Restoring backup into temporary database ${restore_db}..."
createdb --template=template0 -- "${restore_db}"
restore_created=true
pg_restore --exit-on-error --dbname="${restore_db}" -- "${partial}"
psql -X -v ON_ERROR_STOP=1 --dbname="${restore_db}" -Atqc \
  'SELECT 1 FROM public."user", public.user_token, public.verification_email_outbox LIMIT 0' \
  >/dev/null
dropdb -- "${restore_db}"
restore_created=false

if [[ -e "${archive}" ]]; then
  echo "Refusing to overwrite existing backup: ${archive}" >&2
  exit 1
fi
mv -- "${partial}" "${archive}"
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${DB_NAME}-*.dump" \
  -mmin "+$((RETENTION_DAYS * 1440))" -delete
echo "Verified backup: ${archive}"
