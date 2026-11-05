#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

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
  QUIZ_SCHEMA_APPLIED=1
  MEDIA_SCHEMA_APPLIED=1
  MUSICO_SCHEMA_APPLIED=1
}

ensure_musico_schema() {
  if [[ "${MUSICO_SCHEMA_APPLIED:-0}" == 1 ]]; then
    return
  fi
  local musico_schema="${REPO_ROOT}/configs/postgresql/musico.sql"
  if [[ ! -f "${musico_schema}" ]]; then
    echo "Musico database setup files are missing." >&2
    exit 1
  fi
  # Deploy Apps can introduce Musico to an already configured server.
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
SELECT 'CREATE DATABASE musico'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'musico') \gexec
SQL
  sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d musico < "${musico_schema}"
  MUSICO_SCHEMA_APPLIED=1
  if [[ -f /etc/systemd/system/softerr-backup-postgresql.service ]]; then
    install -m 755 "${SCRIPT_DIR}/backup_postgresql.sh" /usr/local/lib/softerr/backup_postgresql.sh
    if ! find /var/backups/softerr -maxdepth 1 -type f -name 'musico-*.dump' -print -quit | grep -q .; then
      systemctl start softerr-backup-postgresql.service
    fi
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
  if [[ "${QUIZ_SCHEMA_APPLIED:-0}" != 1 ]]; then
    local quiz_schema="${REPO_ROOT}/configs/postgresql/quiz.sql"
    if [[ ! -f "${quiz_schema}" ]]; then
      echo "Quiz schema not found: ${quiz_schema}" >&2
      exit 1
    fi
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d quiz < "${quiz_schema}"
    QUIZ_SCHEMA_APPLIED=1
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
  ensure_musico_schema
  run_root_script "${SCRIPT_DIR}/deploy_api.sh"
  API_DEPLOYED=1
}

run_home_deploy() {
  if [[ -z "${HOME_DIST_DIR:-}" && -d "${REPO_ROOT}/app/home/dist" ]]; then
    export HOME_DIST_DIR="${REPO_ROOT}/app/home/dist"
  fi
  run_root_script "${SCRIPT_DIR}/deploy_home.sh"
}

run_quiz_deploy() {
  if [[ -z "${QUIZ_DIST_DIR:-}" && -d "${REPO_ROOT}/app/quiz/dist" ]]; then
    export QUIZ_DIST_DIR="${REPO_ROOT}/app/quiz/dist"
  fi
  run_root_script "${SCRIPT_DIR}/deploy_quiz.sh"
}

run_musico_deploy() {
  ensure_musico_schema
  if [[ "${API_DEPLOYED:-0}" != 1 ]]; then
    run_api_deploy
  fi
  if [[ -z "${MUSICO_DIST_DIR:-}" && -d "${REPO_ROOT}/app/musico/dist" ]]; then
    export MUSICO_DIST_DIR="${REPO_ROOT}/app/musico/dist"
  fi
  run_root_script "${SCRIPT_DIR}/deploy_musico.sh"
}

run_app_deploys() {
  source "${SCRIPT_DIR}/lib/app_selection.sh"
  select_apps "${APP_LIST:-all}"
  local app
  for app in "${SELECTED_APPS[@]}"; do
    case "${app}" in
      api) run_api_deploy ;;
      home) run_home_deploy ;;
      quiz) run_quiz_deploy ;;
      musico) run_musico_deploy ;;
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
    home)
      run_home_deploy
      ;;
    quiz)
      run_quiz_deploy
      ;;
    musico)
      run_musico_deploy
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
      run_home_deploy
      run_quiz_deploy
      run_musico_deploy
      ;;
    *)
      echo "Unknown provisioning component: ${component}"
      echo "Expected one of: all, postgresql, php-fpm, email-worker, nginx, api, home, quiz, musico, apps"
      exit 1
      ;;
  esac
}

main() {
  require_root
  split_components "${PROVISION_COMPONENTS:-all}"
  local component
  for component in "${COMPONENTS[@]}"; do
    run_component "${component}"
  done
}

main "$@"
