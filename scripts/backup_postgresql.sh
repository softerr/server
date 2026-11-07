#!/usr/bin/env bash

set -euo pipefail

if [[ "$(id -un)" != postgres ]]; then
  echo "Run this script as the postgres user." >&2
  exit 1
fi

BACKUP_DIR=/var/backups/softerr
RETENTION_DAYS=30
RETENTION_COUNT=15
APP_REGISTRY_FILE=/etc/softerr/apps.tsv
source /usr/local/lib/softerr/app_registry.sh
load_app_registry /etc/softerr

umask 077
mkdir -p -- "${BACKUP_DIR}"
exec 9> "${BACKUP_DIR}/.backup.lock"
if ! flock -n 9; then
  echo "A database backup is already running." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial=''
restore_db=''
restore_created=false

cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${restore_created}" == true ]]; then
    dropdb --if-exists -- "${restore_db}" || result=1
  fi
  if [[ -n "${partial}" ]]; then
    rm -f -- "${partial}"
  fi
  exit "${result}"
}
trap cleanup EXIT

prune_backups() {
  local db_name="$1" index
  local -a archives=()

  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${db_name}-*.dump" \
    -mmin "+$((RETENTION_DAYS * 1440))" -delete
  mapfile -d '' -t archives < <(
    find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${db_name}-*.dump" -printf '%f\0' | sort -zr
  )
  for ((index = RETENTION_COUNT; index < ${#archives[@]}; index++)); do
    rm -f -- "${BACKUP_DIR}/${archives[index]}"
  done
}

backup_database() {
  local db_name="$1" check_sql="$2" partial_name archive
  partial="$(mktemp -- "${BACKUP_DIR}/.${db_name}-${stamp}.XXXXXXXX.partial")"
  partial_name="${partial##*/}"
  archive="${BACKUP_DIR}/${partial_name#.}"
  archive="${archive%.partial}.dump"
  restore_db="softerr_restore_check_${db_name}_$(date -u +%s)_$$"

  echo "Backing up ${db_name}..."
  pg_dump --format=custom --dbname="${db_name}" --file="${partial}"

  echo "Restoring backup into temporary database ${restore_db}..."
  createdb --template=template0 -- "${restore_db}"
  restore_created=true
  pg_restore --exit-on-error --dbname="${restore_db}" -- "${partial}"
  psql -X -v ON_ERROR_STOP=1 --dbname="${restore_db}" -Atqc "${check_sql}" >/dev/null
  dropdb -- "${restore_db}"
  restore_created=false
  restore_db=''

  if [[ -e "${archive}" ]]; then
    echo "Refusing to overwrite existing backup: ${archive}" >&2
    return 1
  fi
  # The setup directory is setgid to www-data. Publish complete archives with
  # read-only group access so the admin API can serve them without root access.
  chmod 640 -- "${partial}"
  mv -- "${partial}" "${archive}"
  partial=''
  prune_backups "${db_name}"
  echo "Verified backup: ${archive}"
}

backup_database auth \
  'SELECT 1 FROM public."user", public.user_token, public.verification_email_outbox, public.approval_email_outbox LIMIT 0'
backup_database media \
  'SELECT i.id, i.blob_id, b.sha256 FROM public.image i, public.image_blob b LIMIT 0'
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_DATABASES[$app]}" ]] && continue
  backup_database "${APP_DATABASES[$app]}" "${APP_BACKUP_CHECKS[$app]}"
done
