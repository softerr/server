#!/usr/bin/env bash

load_app_registry() {
  local root="${1:?repository root is required}" file="${APP_REGISTRY_FILE:-${1}/configs/apps.tsv}"
  [[ -r "${file}" ]] || { echo "Missing app registry: ${file}" >&2; return 1; }
  WEB_APPS=()
  declare -gA APP_TITLES=() APP_ROUTES=() APP_SOURCES=() APP_TARGETS=() APP_DATABASES=() APP_SCHEMAS=() APP_HEALTH_ROUTES=() APP_DB_CHECKS=() APP_BACKUP_CHECKS=()
  local id title route source target database schema health check_sql backup_check
  while IFS='|' read -r id title route source target database schema health check_sql backup_check; do
    [[ -z "${id}" || "${id}" == \#* ]] && continue
    if [[ ! "${id}" =~ ^[a-z][a-z0-9_]*$ || ! "${route}" =~ ^/[a-z0-9/]*/?$ \
      || ! "${source}" =~ ^app/[a-z0-9_]+$ || ! "${target}" =~ ^/var/www/[a-z0-9_]+$ \
      || ( -n "${database}" && ! "${database}" =~ ^[a-z][a-z0-9_]*$ ) \
      || -n "${APP_ROUTES[${id}]+set}" ]]; then
      echo "Invalid app registry entry: ${id}" >&2
      return 1
    fi
    WEB_APPS+=("${id}")
    APP_TITLES["${id}"]="${title}"
    APP_ROUTES["${id}"]="${route}"
    APP_SOURCES["${id}"]="${source}"
    APP_TARGETS["${id}"]="${target}"
    APP_DATABASES["${id}"]="${database}"
    APP_SCHEMAS["${id}"]="${schema}"
    APP_HEALTH_ROUTES["${id}"]="${health}"
    APP_DB_CHECKS["${id}"]="${check_sql}"
    APP_BACKUP_CHECKS["${id}"]="${backup_check}"
  done < "${file}"
  [[ "${#WEB_APPS[@]}" -gt 0 ]] || { echo 'App registry is empty.' >&2; return 1; }
}

web_app_exists() {
  [[ -n "${APP_ROUTES[$1]+set}" ]]
}

render_web_app_routes() {
  local app route target
  for app in "${WEB_APPS[@]}"; do
    route="${APP_ROUTES[$app]}"
    [[ "${route}" == / ]] && continue
    target="${APP_TARGETS[$app]}"
    cat <<EOF
location = ${route%/} {
    rewrite ^ ${route}index.html last;
}

location ${route} {
    alias ${target}/;
    try_files \$uri \$uri/ ${route}index.html;
}

EOF
  done
}

render_app_api_routes() {
  local root="${1:?repository root is required}" app file
  for app in "${WEB_APPS[@]}"; do
    [[ -n "${APP_HEALTH_ROUTES[$app]}" ]] || continue
    file="${root}/${APP_SOURCES[$app]}/server/nginx.conf"
    [[ -f "${file}" ]] || { echo "Missing app API Nginx routes: ${file}" >&2; return 1; }
    cat -- "${file}"
  done
}
