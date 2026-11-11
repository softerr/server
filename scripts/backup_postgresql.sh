#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script as root.' >&2
  exit 1
fi

BACKUP_DIR=/var/backups/softerr
MEDIA_DIR=/var/lib/softerr/media
CAPTURE_LOCK=/var/lib/softerr/backup-capture.lock
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
    awk '$3 ~ /^[0-9]+$/ && $NF ~ /^([a-z][a-z0-9_]*-[0-9]+T[0-9]+Z\.[A-Za-z0-9]+\.dump|media-files-[0-9]+T[0-9]+Z\.[A-Za-z0-9]+\.tar)$/ {print $NF " " $3}'
}

umask 077
mkdir -p -- "${BACKUP_DIR}"
exec 9> "${BACKUP_DIR}/.backup.lock"
if ! flock -n 9; then
  echo 'A database backup is already running.' >&2
  exit 1
fi
mega mega-whoami >/dev/null
if ! mega mega-ls -l "${MEGA_DIR}" >/dev/null 2>&1; then
  mega mega-mkdir -p "${MEGA_DIR}"
fi

partial=''
restore_db=''
restore_created=false
progress_log=''
media_manifest=''
declare -a captured_databases=() captured_checks=() captured_jobs=() captured_partials=() captured_archives=()
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "${restore_created}" == true ]]; then
    postgres dropdb --if-exists -- "${restore_db}" || result=1
  fi
  [[ -z "${partial}" ]] || rm -f -- "${partial}"
  if (( ${#captured_partials[@]} )); then
    rm -f -- "${captured_partials[@]}"
  fi
  [[ -z "${progress_log}" ]] || rm -f -- "${progress_log}"
  [[ -z "${media_manifest}" ]] || rm -f -- "${media_manifest}"
  exit "${result}"
}
trap cleanup EXIT

upload_to_mega() {
  local archive="$1" name="${1##*/}" pid elapsed=0 progress
  progress_log="$(mktemp -- "${BACKUP_DIR}/.mega-upload.XXXXXXXX.log")"
  mega mega-put "${archive}" "${MEGA_DIR}" >"${progress_log}" 2>&1 &
  pid=$!
  while kill -0 "${pid}" 2>/dev/null; do
    sleep 5
    ((elapsed += 5))
    if (( elapsed % 60 == 0 )) && kill -0 "${pid}" 2>/dev/null; then
      progress="$(tail -c 8192 "${progress_log}" | tr '\r' '\n' |
        sed -nE 's/.*\(([0-9]+)\/([0-9]+) MB: *([0-9]+(\.[0-9]+)?) *%\).*/\3% (\1\/\2 MB)/p' | tail -n 1)"
      echo "MEGA upload ${name}: ${progress:-still transferring}"
    fi
  done
  if ! wait "${pid}"; then
    echo "MEGA upload failed: ${name}" >&2
    tail -c 8192 "${progress_log}" | tr '\r' '\n' | tail -n 20 >&2
    return 1
  fi
  rm -f -- "${progress_log}"
  progress_log=''
}

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
    upload_to_mega "${archive}"
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
  done < <(awk -v prefix="${db}-" 'index($1,prefix)==1 {
    rest=substr($1,length(prefix)+1); if (rest ~ /^[0-9]+T[0-9]+Z\./) print
  }' <<< "${listing}" | sort -r)
}

# Retry archives left behind when an earlier MEGA upload failed.
shopt -s nullglob
for archive in "${BACKUP_DIR}"/*.dump; do
  upload_verified "${archive}"
done
for archive in "${BACKUP_DIR}"/*.tar; do
  upload_verified "${archive}"
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
capture_database() {
  local db="$1" check_sql="$2" compression="${3:-6}" jobs="${4:-1}"
  local archive started
  partial="$(mktemp -- "${BACKUP_DIR}/.${db}-${stamp}.XXXXXXXX.partial")"
  local partial_name="${partial##*/}"
  archive="${BACKUP_DIR}/${partial_name#.}"
  archive="${archive%.partial}.dump"
  chown postgres:www-data "${partial}"
  chmod 640 "${partial}"
  echo "Backing up ${db}..."
  started=$SECONDS
  postgres pg_dump --format=custom --compress="${compression}" --dbname="${db}" --file="${partial}"
  echo "Dumped ${db} in $((SECONDS - started)) seconds."
  captured_databases+=("${db}")
  captured_checks+=("${check_sql}")
  captured_jobs+=("${jobs}")
  captured_partials+=("${partial}")
  captured_archives+=("${archive}")
  partial=''
}

verify_upload_database() {
  local index="$1" db="${captured_databases[$1]}" check_sql="${captured_checks[$1]}"
  local jobs="${captured_jobs[$1]}" archive="${captured_archives[$1]}"
  local captured="${captured_partials[$1]}" started
  restore_db="softerr_restore_check_${db}_$(date -u +%s)_$$"
  echo "Restoring backup into temporary database ${restore_db}..."
  started=$SECONDS
  postgres createdb --template=template0 -- "${restore_db}"
  restore_created=true
  postgres pg_restore --exit-on-error --jobs="${jobs}" --dbname="${restore_db}" -- "${captured}"
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
  mv -- "${captured}" "${archive}"
  upload_verified "${archive}"
}

if [[ ! -f "${CAPTURE_LOCK}" ]]; then
  echo "Backup capture lock is missing: ${CAPTURE_LOCK}" >&2
  exit 1
fi
exec 8<> "${CAPTURE_LOCK}"
echo 'Waiting for active API and worker requests before capturing a restore point...'
flock -x 8
capture_started=$SECONDS
capture_database auth 'SELECT 1 FROM public."user", public.user_token, public.verification_email_outbox, public.approval_email_outbox LIMIT 0'
capture_database media 'SELECT i.id, i.blob_id, b.sha256, token_image.image_id FROM public.image i, public.image_blob b, public.api_token_image_access token_image LIMIT 0' 0 2 1
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_DATABASES[$app]}" ]] && continue
  capture_database "${APP_DATABASES[$app]}" "${APP_BACKUP_CHECKS[$app]}"
done
media_manifest="$(mktemp -- "${BACKUP_DIR}/.media-manifest.XXXXXXXX")"
postgres psql -X -At -F '|' -d media -c \
  "SELECT 'images', trim(sha256), size_bytes FROM public.image_blob
   UNION ALL SELECT 'audio', trim(sha256), size_bytes FROM public.audio_file" \
  > "${media_manifest}"
flock -u 8
exec 8>&-
echo "Captured one restore point in $((SECONDS - capture_started)) seconds; API writes can resume."

for index in "${!captured_databases[@]}"; do
  verify_upload_database "${index}"
done
backup_media_files() {
  local archive partial_name started
  partial="$(mktemp -- "${BACKUP_DIR}/.media-files-${stamp}.XXXXXXXX.partial")"
  chown root:www-data "${partial}"
  chmod 640 "${partial}"
  partial_name="${partial##*/}"
  archive="${BACKUP_DIR}/${partial_name#.}"
  archive="${archive%.partial}.tar"
  echo 'Archiving private media files...'
  started=$SECONDS
  tar -C "${MEDIA_DIR}" --exclude='.upload-*' -cf "${partial}" images thumbnails audio
  python3 /usr/local/lib/softerr/verify_media_archive.py \
    "${partial}" "${MEDIA_DIR}" "${media_manifest}"
  rm -f -- "${media_manifest}"
  media_manifest=''
  echo "Archived and checked media files in $((SECONDS - started)) seconds."
  if [[ -e "${archive}" ]]; then
    echo "Refusing to overwrite existing backup: ${archive}" >&2
    return 1
  fi
  mv -- "${partial}" "${archive}"
  partial=''
  upload_verified "${archive}"
}
backup_media_files

# Old backup sets did not coordinate their databases. Mark this installation
# only after every archive in the new set has passed verification and upload.
touch /var/lib/softerr/backup-capture-ready

# Keep the preceding complete set until every database in this run is verified.
prune_remote auth "${RETENTION_COUNT}"
prune_remote media 1
prune_remote media-files 1
for app in "${WEB_APPS[@]}"; do
  [[ -z "${APP_DATABASES[$app]}" ]] && continue
  prune_remote "${APP_DATABASES[$app]}" "${RETENTION_COUNT}"
done

# Uploaded media archives retain deleted files; prune old local orphans only
# after a complete backup set is safely on MEGA.
python3 - "${MEDIA_DIR}" <<'PY'
import os
import re
import subprocess
import sys
import time

root = sys.argv[1]
cutoff = time.time() - 2 * 86400
sql = "SELECT 'images', trim(sha256) FROM public.image_blob UNION ALL SELECT 'audio', trim(sha256) FROM public.audio_file"
rows = subprocess.check_output(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-At', '-F', '|', '-d', 'media', '-c', sql], text=True)
referenced = {'images': set(), 'audio': set(), 'thumbnails': set()}
for row in rows.splitlines():
    kind, digest = row.split('|')
    referenced[kind].add(digest)
    if kind == 'images':
        referenced['thumbnails'].add(digest)

removed = 0
for kind, keep in referenced.items():
    directory = os.path.join(root, kind)
    for shard in os.scandir(directory):
        if not shard.is_dir(follow_symlinks=False):
            continue
        for entry in os.scandir(shard.path):
            if (entry.is_file(follow_symlinks=False) and re.fullmatch('[a-f0-9]{64}', entry.name)
                    and entry.name not in keep and entry.stat().st_mtime < cutoff):
                os.unlink(entry.path)
                removed += 1
            elif (entry.is_file(follow_symlinks=False) and entry.name.startswith('.upload-')
                    and entry.stat().st_mtime < cutoff):
                os.unlink(entry.path)
                removed += 1
print(f'Removed {removed} unreferenced local media files.')
PY
