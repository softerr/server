#!/usr/bin/env bash

register_app() {
  local id="$1" title="$2" route="$3" target="$4" database="$5" health="$6" check_sql="$7" backup_check="$8"
  local existing
  if [[ ! "${id}" =~ ^[a-z][a-z0-9_]*$ || -z "${title}" \
    || ! "${route}" =~ ^/[a-z0-9/]*/?$ || ! "${target}" =~ ^/var/www/[a-z0-9_]+$ \
    || ( -n "${database}" && ! "${database}" =~ ^[a-z][a-z0-9_]*$ ) \
    || -n "${APP_ROUTES[${id}]+set}" ]]; then
    echo "Invalid app manifest: ${id}" >&2
    return 1
  fi
  if [[ -n "${database}" ]]; then
    [[ "${health}" == "/api/${id}/"* && -n "${check_sql}" && -n "${backup_check}" ]] \
      || { echo "Incomplete API manifest: ${id}" >&2; return 1; }
  elif [[ -n "${health}${check_sql}${backup_check}" ]]; then
    echo "Unexpected API settings in manifest: ${id}" >&2
    return 1
  fi
  for existing in "${WEB_APPS[@]}"; do
    if [[ "${APP_ROUTES[$existing]}" == "${route}" || "${APP_TARGETS[$existing]}" == "${target}" \
      || ( -n "${database}" && "${APP_DATABASES[$existing]}" == "${database}" ) ]]; then
      echo "Conflicting app manifest: ${id}" >&2
      return 1
    fi
  done
  WEB_APPS+=("${id}")
  APP_TITLES["${id}"]="${title}"
  APP_ROUTES["${id}"]="${route}"
  APP_SOURCES["${id}"]="app/${id}"
  APP_TARGETS["${id}"]="${target}"
  APP_DATABASES["${id}"]="${database}"
  APP_SCHEMAS["${id}"]="${database:+app/${id}/server/schema.sql}"
  APP_HEALTH_ROUTES["${id}"]="${health}"
  APP_DB_CHECKS["${id}"]="${check_sql}"
  APP_BACKUP_CHECKS["${id}"]="${backup_check}"
}

load_app_registry() {
  local root="${1:?repository root is required}" file id title route target database health check_sql backup_check count
  local -a manifests
  WEB_APPS=()
  declare -gA APP_TITLES=() APP_ROUTES=() APP_SOURCES=() APP_TARGETS=() APP_DATABASES=() APP_SCHEMAS=() APP_HEALTH_ROUTES=() APP_DB_CHECKS=() APP_BACKUP_CHECKS=()
  if [[ -n "${APP_REGISTRY_FILE:-}" ]]; then
    file="${APP_REGISTRY_FILE}"
    [[ -r "${file}" ]] || { echo "Missing installed app registry: ${file}" >&2; return 1; }
    while IFS='|' read -r id title route target database health check_sql backup_check; do
      [[ -z "${id}" || "${id}" == \#* ]] && continue
      register_app "${id}" "${title}" "${route}" "${target}" "${database}" "${health}" "${check_sql}" "${backup_check}" || return 1
    done < "${file}"
  else
    manifests=("${root}"/app/*/app.tsv)
    for file in "${manifests[@]}"; do
      [[ -r "${file}" ]] || continue
      id="${file%/app.tsv}"
      id="${id##*/}"
      count=0
      while IFS='|' read -r title route target database health check_sql backup_check; do
        [[ -z "${title}" || "${title}" == \#* ]] && continue
        ((count += 1))
        [[ "${count}" -eq 1 ]] || { echo "Multiple entries in app manifest: ${file}" >&2; return 1; }
        register_app "${id}" "${title}" "${route}" "${target}" "${database}" "${health}" "${check_sql}" "${backup_check}" || return 1
      done < "${file}"
      [[ "${count}" -eq 1 ]] || { echo "Empty app manifest: ${file}" >&2; return 1; }
    done
  fi
  [[ "${#WEB_APPS[@]}" -gt 0 ]] || { echo 'App registry is empty.' >&2; return 1; }
}

render_app_registry() {
  local app
  for app in "${WEB_APPS[@]}"; do
    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${app}" "${APP_TITLES[$app]}" \
      "${APP_ROUTES[$app]}" "${APP_TARGETS[$app]}" "${APP_DATABASES[$app]}" \
      "${APP_HEALTH_ROUTES[$app]}" "${APP_DB_CHECKS[$app]}" "${APP_BACKUP_CHECKS[$app]}"
  done
}

install_app_registry() {
  local target="${1:-/etc/softerr/apps.tsv}" temporary
  install -d -m 755 "${target%/*}"
  temporary="$(mktemp "${target}.XXXXXXXX")" || return 1
  if ! render_app_registry > "${temporary}"; then
    rm -f -- "${temporary}"
    return 1
  fi
  chmod 644 "${temporary}"
  mv -f -- "${temporary}" "${target}"
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
