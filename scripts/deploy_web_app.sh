#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/app_registry.sh"
source "${SCRIPT_DIR}/lib/atomic_deploy.sh"
source "${SCRIPT_DIR}/lib/deploy_checks.sh"
load_app_registry "${REPO_ROOT}"

app="${1:?Usage: deploy_web_app.sh <app name>}"
if ! web_app_exists "${app}"; then
  echo "Unknown web app: ${app}" >&2
  exit 1
fi
override="${app^^}_DIST_DIR"
target_override="${app^^}_TARGET_DIR"
source_dir="${!override:-${REMOTE_DIR:-/tmp/workflow-artifacts}/${APP_SOURCES[${app}]}/dist}"
target_dir="${!target_override:-${APP_TARGETS[${app}]}}"
app_deploy_hook="${REPO_ROOT}/${APP_SOURCES[$app]}/deploy.sh"
if [[ -f "${app_deploy_hook}" ]]; then
  APP_DEPLOY_SOURCE="${source_dir}" APP_DEPLOY_TARGET="${target_dir}" \
    APP_DEPLOY_ROUTE="${APP_ROUTES[$app]}" exec bash "${app_deploy_hook}"
fi
if [[ ! -f "${source_dir}/index.html" ]]; then
  echo "Prebuilt ${app} artifacts not found: ${source_dir}" >&2
  exit 1
fi

echo "Deploying ${app} from ${source_dir} to ${target_dir}"
atomic_deploy_dir "${source_dir}" "${target_dir}" "${WEB_USER:-www-data}" "${WEB_GROUP:-www-data}" \
  verify_local_app_route "${APP_ROUTES[${app}]}" file "${target_dir}/index.html"
echo "${APP_TITLES[${app}]} deployed successfully."
