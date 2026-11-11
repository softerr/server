#!/usr/bin/env bash

run_initial_backup() {
  local started pid wait_seconds=0 stage
  while [[ "$(systemctl show --value -p ActiveState softerr-backup-postgresql.service)" =~ ^(active|activating|reloading)$ ]]; do
    sleep 5
    wait_seconds=$((wait_seconds + 5))
    if (( wait_seconds % 60 == 0 )); then
      echo 'Waiting for the current backup service run to finish before starting a new capture...'
    fi
  done
  started="$(date '+%Y-%m-%d %H:%M:%S')"
  systemctl start softerr-backup-postgresql.service &
  pid=$!
  while kill -0 "${pid}" 2>/dev/null; do
    sleep 1
    wait_seconds=$((wait_seconds + 1))
    if (( wait_seconds % 60 == 0 )) && kill -0 "${pid}" 2>/dev/null; then
      stage="$(journalctl --quiet --no-pager --output=cat --unit=softerr-backup-postgresql.service \
        --since="${started}" -n 1 2>/dev/null || true)"
      echo "Initial backup and restore checks are still running: ${stage:-waiting for service output}"
    fi
  done
  if ! wait "${pid}"; then
    journalctl --quiet --no-pager --output=cat --unit=softerr-backup-postgresql.service \
      --since="${started}" || true
    echo 'Initial database backup or restore check failed.' >&2
    return 1
  fi
  journalctl --quiet --no-pager --output=cat --unit=softerr-backup-postgresql.service \
    --since="${started}" || true
  echo 'Initial database backups and restore checks passed.'
}
