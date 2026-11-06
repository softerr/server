#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/app_selection.sh"
select_apps "${1:-all}"

for app in "${SELECTED_APPS[@]}"; do
  [[ "${app}" == api ]] && continue
  echo "Building ${app}..."
  (
    cd "${REPO_ROOT}/${APP_SOURCES[$app]}"
    npm ci
    npm run build
    test -f dist/index.html
  )
done
