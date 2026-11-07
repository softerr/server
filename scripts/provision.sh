#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/app_registry.sh"
source "${SCRIPT_DIR}/lib/apt_locks.sh"
load_app_registry "${REPO_ROOT}"
declare -A SCHEMA_APPLIED=()

split_components() {
  local raw="${1:-all}"
  local normalized="${raw//,/ }"
  local part
  COMPONENTS=()
  for part in ${normalized}; do
    [[ -n "${part}" ]] && COMPONENTS+=("${part}")
  done
  if [[ "${#COMPONENTS[@]}" -eq 0 ]]; then
    COMPONENTS=("all")
  fi
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this script as root (for example: sudo bash scripts/provision.sh)."
    exit 1
  fi
}

run_root_script() {
  local script_path="$1"
  if [[ ! -f "${script_path}" ]]; then
    echo "Script not found: ${script_path}"
    exit 1
  fi
  chmod +x "${script_path}"
  bash "${script_path}"
}

run_postgresql() {
  run_root_script "${SCRIPT_DIR}/setup_postgresql.sh"
  AUTH_SCHEMA_APPLIED=1
  MEDIA_SCHEMA_APPLIED=1
  local app
  for app in "${WEB_APPS[@]}"; do SCHEMA_APPLIED["${app}"]=1; done
}

ensure_app_schema() {
  local app="$1" database="${APP_DATABASES[$1]}" schema="${APP_SCHEMAS[$1]}"
  [[ -n "${database}" ]] || return 0
  [[ "${SCHEMA_APPLIED[${app}]:-0}" == 1 ]] && return 0
  if [[ ! -f "${REPO_ROOT}/${schema}" ]]; then
    echo "App database schema is missing: ${schema}" >&2
    exit 1
  fi
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<SQL
SELECT 'CREATE DATABASE ${database}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${database}') \gexec
SQL
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d "${database}" < "${REPO_ROOT}/${schema}"
  SCHEMA_APPLIED["${app}"]=1
  if [[ -f /etc/systemd/system/softerr-backup-postgresql.service ]]; then
    install -m 644 "${REPO_ROOT}/configs/apps.tsv" /etc/softerr/apps.tsv
    install -m 644 "${SCRIPT_DIR}/lib/app_registry.sh" /usr/local/lib/softerr/app_registry.sh
    install -m 755 "${SCRIPT_DIR}/backup_postgresql.sh" /usr/local/lib/softerr/backup_postgresql.sh
    echo "Updated backup registry for ${database}; the daily timer will include it."
  fi
}

run_nginx() {
  run_root_script "${SCRIPT_DIR}/setup_nginx.sh"
}

run_php_fpm() {
  run_root_script "${SCRIPT_DIR}/setup_php_fpm.sh"
}

run_email_worker() {
  run_root_script "${SCRIPT_DIR}/setup_email_worker.sh"
}

run_api_deploy() {
  if [[ "${AUTH_SCHEMA_APPLIED:-0}" != 1 ]]; then
    local auth_schema="${REPO_ROOT}/configs/postgresql/auth.sql"
    if [[ ! -f "${auth_schema}" ]]; then
      echo "Auth schema not found: ${auth_schema}" >&2
      exit 1
    fi
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d auth < "${auth_schema}"
    AUTH_SCHEMA_APPLIED=1
  fi
  if [[ "${MEDIA_SCHEMA_APPLIED:-0}" != 1 ]]; then
    local media_schema="${REPO_ROOT}/configs/postgresql/media.sql"
    if [[ ! -f "${media_schema}" ]]; then
      echo "Media schema not found: ${media_schema}" >&2
      exit 1
    fi
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d media < "${media_schema}"
    MEDIA_SCHEMA_APPLIED=1
  fi
  local app
  for app in "${WEB_APPS[@]}"; do ensure_app_schema "${app}"; done
  run_root_script "${SCRIPT_DIR}/deploy_api.sh"
  API_DEPLOYED=1
}

run_web_deploy() {
  local app="$1" override="${1^^}_DIST_DIR"
  ensure_app_schema "${app}"
  if [[ -n "${APP_HEALTH_ROUTES[${app}]}" && "${API_DEPLOYED:-0}" != 1 ]]; then
    run_api_deploy
  fi
  if [[ -z "${!override:-}" && -d "${REPO_ROOT}/${APP_SOURCES[${app}]}/dist" ]]; then
    export "${override}=${REPO_ROOT}/${APP_SOURCES[${app}]}/dist"
  fi
  bash "${SCRIPT_DIR}/deploy_web_app.sh" "${app}"
}

run_app_deploys() {
  source "${SCRIPT_DIR}/lib/app_selection.sh"
  select_apps "${APP_LIST:-all}"
  local app
  for app in "${SELECTED_APPS[@]}"; do
    case "${app}" in
      api) run_api_deploy ;;
      *) run_web_deploy "${app}" ;;
    esac
  done
}

run_component() {
  local component="$1"
  case "${component}" in
    postgresql)
      run_postgresql
      ;;
    nginx)
      run_nginx
      ;;
    php-fpm)
      run_php_fpm
      ;;
    email-worker)
      run_email_worker
      ;;
    api)
      run_api_deploy
      ;;
    apps)
      run_app_deploys
      ;;
    all)
      run_postgresql
      run_php_fpm
      run_email_worker
      run_nginx
      run_api_deploy
      local app
      for app in "${WEB_APPS[@]}"; do run_web_deploy "${app}"; done
      ;;
    *)
      if web_app_exists "${component}"; then run_web_deploy "${component}"
      else
        echo "Unknown provisioning component: ${component}" >&2
        echo "Expected one of: all, postgresql, php-fpm, email-worker, nginx, api, apps, ${WEB_APPS[*]}" >&2
        exit 1
      fi
      ;;
  esac
}

main() {
  require_root
  remove_duplicate_mega_apt_source
  split_components "${PROVISION_COMPONENTS:-all}"
  local component
  for component in "${COMPONENTS[@]}"; do
    run_component "${component}"
  done
}

main "$@"
