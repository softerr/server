#!/usr/bin/env bash

BACKUP_CAPTURE_LOCK=/var/lib/softerr/backup-capture.lock

ensure_backup_capture_lock() {
  install -d -m 755 /var/lib/softerr
  if [[ ! -e "${BACKUP_CAPTURE_LOCK}" ]]; then
    install -o root -g www-data -m 640 /dev/null "${BACKUP_CAPTURE_LOCK}"
  fi
  if [[ ! -f "${BACKUP_CAPTURE_LOCK}" || -L "${BACKUP_CAPTURE_LOCK}" ]]; then
    echo "Invalid backup capture lock: ${BACKUP_CAPTURE_LOCK}" >&2
    return 1
  fi
  chown root:www-data "${BACKUP_CAPTURE_LOCK}"
  chmod 640 "${BACKUP_CAPTURE_LOCK}"
}

lock_schema_setup() {
  exec 8<> "${BACKUP_CAPTURE_LOCK}"
  flock -s 8
}

unlock_schema_setup() {
  flock -u 8
  exec 8>&-
}
