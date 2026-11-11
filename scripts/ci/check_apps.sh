#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
for hook in "${REPO_ROOT}"/app/*/check.sh; do
  [[ -f "${hook}" ]] || continue
  echo "Checking ${hook%/check.sh}..."
  bash "${hook}"
done
