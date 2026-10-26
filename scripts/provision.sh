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
}

run_nginx() {
  run_root_script "${SCRIPT_DIR}/setup_nginx.sh"
}

run_api_deploy() {
  run_root_script "${SCRIPT_DIR}/deploy_api.sh"
}

run_quiz_deploy() {
  if [[ -z "${QUIZ_DIST_DIR:-}" && -d "${REPO_ROOT}/app/quiz/dist" ]]; then
    export QUIZ_DIST_DIR="${REPO_ROOT}/app/quiz/dist"
  fi
  run_root_script "${SCRIPT_DIR}/deploy_quiz.sh"
}

run_app_deploys() {
  source "${SCRIPT_DIR}/lib/app_selection.sh"
  select_apps "${APP_LIST:-all}"
  local app
  for app in "${SELECTED_APPS[@]}"; do
    case "${app}" in
      api) run_api_deploy ;;
      quiz) run_quiz_deploy ;;
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
    api)
      run_api_deploy
      ;;
    quiz)
      run_quiz_deploy
      ;;
    apps)
      run_app_deploys
      ;;
    all)
      run_postgresql
      run_nginx
      run_api_deploy
      run_quiz_deploy
      ;;
    *)
      echo "Unknown provisioning component: ${component}"
      echo "Expected one of: all, postgresql, nginx, api, quiz, apps"
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
