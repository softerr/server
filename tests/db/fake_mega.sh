#!/usr/bin/env bash
set -euo pipefail
store=${SOFTERR_FAKE_MEGA_STORE:-/var/lib/softerr-mega-test}
case "${0##*/}" in
  mega-whoami) echo 'test@example.invalid' ;;
  mega-mkdir)
    if [[ -d "$store" ]]; then
      echo 'Folder already exists: softerr-backups' >&2
      exit 54
    fi
    mkdir -p "$store"
    ;;
  mega-put) cp -- "$1" "$store/${1##*/}" ;;
  mega-get) cp -- "$store/${1##*/}" "$2/" ;;
  mega-rm) rm -f -- "$store/${2##*/}" ;;
  mega-ls)
    [[ -d "$store" ]] || exit 1
    for archive in "$store"/*.dump "$store"/*.tar; do
      [[ -f "$archive" ]] || continue
      printf '%s %s %s %s %s\n' '----' 1 "$(stat -c %s "$archive")" '2026-01-01' "${archive##*/}"
    done
    ;;
  *) echo "Unknown fake MEGA command: ${0##*/}" >&2; exit 1 ;;
esac
