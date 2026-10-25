#!/usr/bin/env bash

# Copy and prepare a release beside its target, then publish it in one rename.
atomic_deploy_dir() (
  set -euo pipefail

  local source_dir="$1"
  local target_dir="$2"
  local web_user="$3"
  local web_group="$4"
  local parent name stage_dir

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

  if [[ -L "${target_dir}" || ( -e "${target_dir}" && ! -d "${target_dir}" ) ]]; then
    echo "Deployment target must be a directory: ${target_dir}"
    return 1
  fi

  stage_dir="$(mktemp -d -- "${parent}/.${name}.next.XXXXXXXX")"
  trap 'rm -rf -- "${stage_dir}"' EXIT

  if command -v rsync >/dev/null 2>&1; then
    rsync -a -- "${source_dir}/" "${stage_dir}/"
  else
    cp -a -- "${source_dir}/." "${stage_dir}/"
  fi

  chown -R "${web_user}:${web_group}" "${stage_dir}"
  find "${stage_dir}" -type d -exec chmod 755 {} +
  find "${stage_dir}" -type f -exec chmod 644 {} +

  # Linux renameat2 can atomically exchange two nonempty directories. For the
  # first deploy, RENAME_NOREPLACE atomically publishes the staged directory.
  python3 - "${stage_dir}" "${target_dir}" <<'PY'
import ctypes
import os
import sys

stage, target = sys.argv[1:]
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = libc.renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int

AT_FDCWD = -100
RENAME_NOREPLACE = 1
RENAME_EXCHANGE = 2
flag = RENAME_EXCHANGE if os.path.lexists(target) else RENAME_NOREPLACE

if renameat2(AT_FDCWD, os.fsencode(stage), AT_FDCWD, os.fsencode(target), flag) != 0:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error), target)
PY
)
