#!/usr/bin/env bash

# Copy and prepare a release beside its target, then publish it in one rename.
# Optional trailing arguments run a verification command before the old release
# is removed. A failed check restores the previous directory.
atomic_rename_dir() {
  python3 - "$1" "$2" "$3" <<'PY'
import ctypes
import os
import sys

source, target, mode = sys.argv[1:]
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = libc.renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int

AT_FDCWD = -100
flags = {'new': 1, 'exchange': 2}
if renameat2(AT_FDCWD, os.fsencode(source), AT_FDCWD, os.fsencode(target), flags[mode]) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error), target)
PY
}

atomic_deploy_dir() (
  set -euo pipefail

  local source_dir="$1"
  local target_dir="$2"
  local web_user="$3"
  local web_group="$4"
  local parent name stage_dir previous_release=false published=false verified=false preserve_stage=false
  local -a verify_command=()

  if (( $# > 4 )); then
    verify_command=("${@:5}")
  fi

  if [[ ! -d "${source_dir}" || "${target_dir}" != /* ]]; then
    echo "Invalid source or target directory for atomic deployment."
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for atomic deployment."
    return 1
  fi

  target_dir="$(realpath -m -s -- "${target_dir}")"
  if [[ "${target_dir}" == / ]]; then
    echo "Refusing to deploy over the filesystem root."
    return 1
  fi
  parent="$(dirname -- "${target_dir}")"
  name="$(basename -- "${target_dir}")"
  target_dir="${parent}/${name}"
  mkdir -p -- "${parent}"
  exec 8< "${parent}"
  flock -x 8

  if [[ -L "${target_dir}" || ( -e "${target_dir}" && ! -d "${target_dir}" ) ]]; then
    echo "Deployment target must be a directory: ${target_dir}"
    return 1
  fi
  if [[ -d "${target_dir}" ]]; then
    previous_release=true
  fi

  stage_dir="$(mktemp -d -- "${parent}/.${name}.next.XXXXXXXX")"
  cleanup_deploy() {
    local result=$?
    trap - EXIT HUP INT TERM
    if [[ "${published}" == true && "${verified}" != true ]]; then
      echo "Deployment verification failed for ${target_dir}; restoring previous release." >&2
      if [[ "${previous_release}" == true ]]; then
        if atomic_rename_dir "${stage_dir}" "${target_dir}" exchange; then
          preserve_stage=false
          echo "Previous release restored at ${target_dir}." >&2
        fi
      elif mv -- "${target_dir}" "${stage_dir}"; then
        preserve_stage=false
        echo "Failed first release removed from ${target_dir}." >&2
      fi
      result=1
    fi
    if [[ "${preserve_stage}" == true ]]; then
      echo "Previous release may remain at ${stage_dir}; inspect it before retrying." >&2
      result=1
    else
      rm -rf -- "${stage_dir}" || result=1
    fi
    exit "${result}"
  }
  trap cleanup_deploy EXIT
  trap 'exit 1' HUP INT TERM

  if command -v rsync >/dev/null 2>&1; then
    rsync -a -- "${source_dir}/" "${stage_dir}/"
  else
    cp -a -- "${source_dir}/." "${stage_dir}/"
  fi

  chown -R "${web_user}:${web_group}" "${stage_dir}"
  find "${stage_dir}" -type d -exec chmod 755 {} +
  find "${stage_dir}" -type f -exec chmod 644 {} +

  preserve_stage=true
  if [[ "${previous_release}" == true ]]; then
    if ! atomic_rename_dir "${stage_dir}" "${target_dir}" exchange; then
      preserve_stage=false
      return 1
    fi
  elif ! atomic_rename_dir "${stage_dir}" "${target_dir}" new; then
    preserve_stage=false
    return 1
  fi
  published=true

  if (( ${#verify_command[@]} > 0 )) && ! "${verify_command[@]}"; then
    return 1
  fi
  verified=true
  preserve_stage=false
)
