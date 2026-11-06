#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/app_selection.sh"
load_app_registry "${REPO_ROOT}"

declare -A routes=() targets=() databases=()
for app in "${WEB_APPS[@]}"; do
  route="${APP_ROUTES[$app]}"
  target="${APP_TARGETS[$app]}"
  [[ -z "${routes[$route]:-}" && -z "${targets[$target]:-}" ]]
  routes["${route}"]=1
  targets["${target}"]=1
  [[ -f "${REPO_ROOT}/${APP_SOURCES[$app]}/package-lock.json" ]]
  if [[ -n "${APP_DATABASES[$app]}" ]]; then
    database="${APP_DATABASES[$app]}"
    [[ -z "${databases[$database]:-}" ]]
    databases["${database}"]=1
    [[ -f "${REPO_ROOT}/${APP_SCHEMAS[$app]}" ]]
    [[ -n "${APP_DB_CHECKS[$app]}" && -n "${APP_BACKUP_CHECKS[$app]}" ]]
    [[ -f "${REPO_ROOT}/${APP_SOURCES[$app]}/server/health.php" ]]
    [[ -f "${REPO_ROOT}/${APP_SOURCES[$app]}/server/nginx.conf" ]]
    [[ -f "${REPO_ROOT}/app/api/${app}.php" ]]
  fi
  select_apps "${app}"
  [[ "${SELECTED_APPS[*]}" == "${app}" ]]
done

web_routes="$(render_web_app_routes)"
api_routes="$(render_app_api_routes "${REPO_ROOT}")"
for app in "${WEB_APPS[@]}"; do
  [[ "${APP_ROUTES[$app]}" == / ]] || [[ "${web_routes}" == *"location ${APP_ROUTES[$app]} {"* ]]
  [[ -z "${APP_HEALTH_ROUTES[$app]}" ]] || [[ "${api_routes}" == *"location /api/${app}/ {"* ]]
done

select_apps all
[[ "${#SELECTED_APPS[@]}" -eq "$((${#WEB_APPS[@]} + 1))" ]]
echo 'App registry checks passed.'
