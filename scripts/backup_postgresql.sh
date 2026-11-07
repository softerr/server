#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script as root.' >&2
  exit 1
fi

BACKUP_DIR=/var/backups/softerr
MEGA_DIR=/softerr-backups
MEGA_HOME=/var/lib/softerr-mega
RETENTION_DAYS=7
RETENTION_COUNT=7
APP_REGISTRY_FILE=/etc/softerr/apps.tsv
source /usr/local/lib/softerr/app_registry.sh
load_app_registry /etc/softerr

mega() { runuser -u www-data -- env HOME="${MEGA_HOME}" "$@"; }
postgres() { runuser -u postgres -- "$@"; }

# The listing is parsed only for archives with our generated, single-token names.
remote_files() {
  mega mega-ls -l "${MEGA_DIR}" |
    awk '$3 ~ /^[0-9]+$/ && $NF ~ /^[a-z][a-z0-9_]*-[0-9]+T[0-9]+Z\.[A-Za-z0-9]+\.dump$/ {print $NF " " $3}'
}

umask 077
mkdir -p -- "${BACKUP_DIR}"
exec 9> "${BACKUP_DIR}/.backup.lock"
if ! flock -n 9; then
  echo 'A database backup is already running.' >&2
  exit 1
fi
mega mega-whoami >/dev/null
mega mega-mkdir -p "${MEGA_DIR}"

partial=''
restore_db=''
restore_created=false
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${restore_created}" == true ]]; then
    postgres dropdb --if-exists -- "${restore_db}" || result=1
  fi
  [[ -z "${partial}" ]] || rm -f -- "${partial}"
  exit "${result}"
}
trap cleanup EXIT

upload_verified() {
  local archive="$1" name="${1##*/}" listing matches size
  size="$(stat -c %s -- "${archive}")"
  listing="$(remote_files)"
  matches="$(awk -v name="${name}" '$1 == name {print $2}' <<< "${listing}")"
  if [[ -n "${matches}" ]]; then
    if [[ "${matches}" != "${size}" ]]; then
      echo "Remote backup conflicts with local archive: ${name}" >&2
      return 1
    fi
  else
    echo "Uploading ${name} to MEGA..."
    mega mega-put "${archive}" "${MEGA_DIR}"
    listing="$(remote_files)"
    matches="$(awk -v name="${name}" '$1 == name {print $2}' <<< "${listing}")"
    if [[ "${matches}" != "${size}" ]]; then
      echo "MEGA upload could not be verified: ${name}" >&2
      return 1
    fi
  fi
  rm -f -- "${archive}"
  echo "Verified on MEGA: ${name}"
}

prune_remote() {
  local db="$1" keep="$2" cutoff listing name size count=0 stamp
  cutoff="$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%dT%H%M%SZ)"
  listing="$(remote_files)"
  while read -r name size; do
    [[ -n "${name}" ]] || continue
    stamp="${name#"${db}-"}"
    stamp="${stamp%%.*}"
    ((count += 1))
    if (( count > keep )) || [[ "${stamp}" < "${cutoff}" ]]; then
      mega mega-rm -f "${MEGA_DIR}/${name}"
      echo "Removed expired MEGA backup: ${name}"
    fi
  done < <(awk -v prefix="${db}-" 'index($1,prefix)==1' <<< "${listing}" | sort -r)
}

# Move verified archives from the previous local-backup implementation to MEGA.
shopt -s nullglob
for archive in "${BACKUP_DIR}"/*.dump; do
  upload_verified "${archive}"
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_database() {
  local db="$1" check_sql="$2" compression="${3:-6}" jobs="${4:-1}"
  local archive started
  partial="$(mktemp -- "${BACKUP_DIR}/.${db}-${stamp}.XXXXXXXX.partial")"
  local partial_name="${partial##*/}"
  archive="${BACKUP_DIR}/${partial_name#.}"
  archive="${archive%.partial}.dump"
  restore_db="softerr_restore_check_${db}_$(date -u +%s)_$$"
  chown postgres:www-data "${partial}"
  chmod 640 "${partial}"
  echo "Backing up ${db}..."
  started=$SECONDS
  postgres pg_dump --format=custom --compress="${compression}" --dbname="${db}" --file="${partial}"
  echo "Dumped ${db} in $((SECONDS - started)) seconds."
  echo "Restoring backup into temporary database ${restore_db}..."
  started=$SECONDS
  postgres createdb --template=template0 -- "${restore_db}"
  restore_created=true
  postgres pg_restore --exit-on-error --jobs="${jobs}" --dbname="${restore_db}" -- "${partial}"
  echo "Loaded ${db} in $((SECONDS - started)) seconds."
  started=$SECONDS
  postgres psql -X -v ON_ERROR_STOP=1 --dbname="${restore_db}" -Atqc "${check_sql}" >/dev/null
  echo "Checked ${db} in $((SECONDS - started)) seconds."
  postgres dropdb -- "${restore_db}"
  restore_created=false
  restore_db=''
  if [[ -e "${archive}" ]]; then
    echo "Refusing to overwrite existing backup: ${archive}" >&2
    return 1
  fi
  mv -- "${partial}" "${archive}"
  partial=''
  upload_verified "${archive}"
}

backup_database auth 'SELECT 1 FROM public."user", public.user_token, public.verification_email_outbox, public.approval_email_outbox LIMIT 0'
backup_database media 'SELECT i.id, i.blob_id, b.sha256 FROM public.image i, public.image_blob b LIMIT 0' 0 2 1
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_DATABASES[$app]}" ]] && continue
  backup_database "${APP_DATABASES[$app]}" "${APP_BACKUP_CHECKS[$app]}"
done

# Keep the preceding complete set until every database in this run is verified.
prune_remote auth "${RETENTION_COUNT}"
prune_remote media 1
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_DATABASES[$app]}" ]] && continue
  prune_remote "${APP_DATABASES[$app]}" "${RETENTION_COUNT}"
done
