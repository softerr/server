#!/usr/bin/env bash

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

