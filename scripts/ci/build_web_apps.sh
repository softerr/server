#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/app_selection.sh"
select_apps "${1:-all}"

for app in "${SELECTED_APPS[@]}"; do
  [[ "${app}" == api ]] && continue
  echo "Building ${app}..."
  app_dir="${REPO_ROOT}/${APP_SOURCES[$app]}"
  [[ -f "${app_dir}/build.sh" ]] || { echo "Missing ${app} build hook" >&2; exit 1; }
  bash "${app_dir}/build.sh"
  test -f "${app_dir}/dist/index.html"
done
