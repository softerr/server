#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf -- "${fixture_dir}"' EXIT

printf '%s\n' "$$" > "${fixture_dir}/qemu.pid"
printf 'keep-disk\n' > "${fixture_dir}/server-clone.qcow2"

if output="$(QEMU_ENV_FILE=/nonexistent VM_DIR="${fixture_dir}" RECREATE_VM_DISK=1 \
  bash "${repo_root}/scripts/qemu.sh" start 2>&1)"; then
  echo "Starting a running VM with RECREATE_VM_DISK=1 unexpectedly succeeded." >&2
  exit 1
fi

if [[ "${output}" != *'Cannot recreate the VM disk while the VM is running'* ]]; then
  echo "VM recreation failed for an unexpected reason: ${output}" >&2
  exit 1
fi

if [[ "$(cat "${fixture_dir}/server-clone.qcow2")" != 'keep-disk' ]]; then
  echo "The running VM disk changed." >&2
  exit 1
fi

echo "Running VM disk recreation is refused before changing the disk."
