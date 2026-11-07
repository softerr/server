#!/usr/bin/env bash
set -euo pipefail
store=/var/lib/softerr-mega-test
case "${0##*/}" in
  mega-whoami) echo 'test@example.invalid' ;;
  mega-mkdir) mkdir -p "$store" ;;
  mega-put) cp -- "$1" "$store/${1##*/}" ;;
  mega-get) cp -- "$store/${1##*/}" "$2/" ;;
  mega-rm) rm -f -- "$store/${2##*/}" ;;
  mega-ls)
    for archive in "$store"/*.dump; do
      [[ -f "$archive" ]] || continue
      printf '%s %s %s %s %s\n' '----' 1 "$(stat -c %s "$archive")" '2026-01-01' "${archive##*/}"
    done
    ;;
  *) echo "Unknown fake MEGA command: ${0##*/}" >&2; exit 1 ;;
esac
