#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/ci/upload_artifacts.sh <server|nginx|postgresql|apps|api-tests>"
  exit 1
fi

MODE="$1"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

: "${SERVER_HOST:?SERVER_HOST is required}"
: "${SERVER_USER:?SERVER_USER is required}"

source "${SCRIPT_DIR}/load_ssh_env.sh"
source "${REPO_ROOT}/scripts/lib/app_selection.sh"

upload_script_lib() {
  local path
  local -a files=()
  while IFS= read -r -d '' path; do
    files+=("${REPO_ROOT}/${path}")
  done < <(find "${REPO_ROOT}/scripts/lib" -maxdepth 1 -type f -printf 'scripts/lib/%f\0')
  if [[ "${#files[@]}" -eq 0 ]]; then
    echo 'No scripts/lib files found for the deployment artifact.' >&2
    exit 1
  fi
  scp $SSH_OPTS -P "$PORT" "${files[@]}" \
    "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
}

upload_app_manifests() {
  local app
  for app in "${WEB_APPS[@]}"; do
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/app/${app}'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/${APP_SOURCES[$app]}/app.tsv" \
      "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/app.tsv"
  done
}

upload_app_deploy_hooks() {
  local app hook
  for app in "${WEB_APPS[@]}"; do
    hook="${REPO_ROOT}/${APP_SOURCES[$app]}/deploy.sh"
    [[ -f "${hook}" ]] || continue
    scp $SSH_OPTS -P "$PORT" "${hook}" \
      "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/deploy.sh"
  done
}

case "${MODE}" in
  server)
    select_apps all
    for entrypoint in index auth media; do
      [[ -f "${REPO_ROOT}/app/api/${entrypoint}.php" ]] || { echo "Missing API ${entrypoint}.php" >&2; exit 1; }
    done
    for app in "${WEB_APPS[@]}"; do
      [[ -f "${REPO_ROOT}/${APP_SOURCES[$app]}/dist/index.html" ]] || { echo "Missing built ${app} app" >&2; exit 1; }
      if [[ -n "${APP_HEALTH_ROUTES[$app]}" && ! -f "${REPO_ROOT}/${APP_SOURCES[$app]}/server/entrypoint.php" ]]; then
        echo "Missing ${app} API entry point" >&2
        exit 1
      fi
    done
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs' '$REMOTE_DIR/app/api'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "${REPO_ROOT}/scripts/setup_server.sh" \
      "${REPO_ROOT}/scripts/setup_tls_certificate.sh" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" \
      "${REPO_ROOT}/scripts/setup_php_fpm.sh" "${REPO_ROOT}/scripts/setup_email_worker.sh" \
      "${REPO_ROOT}/scripts/setup_nginx.sh" "${REPO_ROOT}/scripts/deploy_api.sh" \
      "${REPO_ROOT}/scripts/deploy_web_app.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    upload_script_lib
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    upload_app_manifests
    upload_app_deploy_hooks
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    for app in "${WEB_APPS[@]}"; do
      ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/dist' '$REMOTE_DIR/${APP_SOURCES[$app]}/server'"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/${APP_SOURCES[$app]}/dist/." \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/dist/"
      if [[ -d "${REPO_ROOT}/${APP_SOURCES[$app]}/server" ]]; then
        scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/${APP_SOURCES[$app]}/server/." \
          "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/server/"
      fi
    done
    ;;
  nginx)
    load_app_registry "${REPO_ROOT}"
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_php_fpm.sh" \
      "${REPO_ROOT}/scripts/setup_email_worker.sh" \
      "${REPO_ROOT}/scripts/setup_nginx.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    upload_script_lib
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    upload_app_manifests
    for app in "${WEB_APPS[@]}"; do
      [[ -n "${APP_HEALTH_ROUTES[$app]}" ]] || continue
      ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/server'"
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/${APP_SOURCES[$app]}/server/nginx.conf" \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/server/"
    done
    ;;
  postgresql)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    upload_script_lib
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    load_app_registry "${REPO_ROOT}"
    upload_app_manifests
    for app in "${WEB_APPS[@]}"; do
      [[ -n "${APP_SCHEMAS[$app]}" ]] || continue
      ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/server'"
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/${APP_SCHEMAS[$app]}" \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SCHEMAS[$app]}"
      if [[ -f "${REPO_ROOT}/${APP_SOURCES[$app]}/server/media.sql" ]]; then
        scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/${APP_SOURCES[$app]}/server/media.sql" \
          "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/server/media.sql"
      fi
    done
    ;;
  apps)
    select_apps "${APP_LIST:-all}"
    needs_api=false
    for app in "${SELECTED_APPS[@]}"; do
      if [[ "${app}" == api || -n "${APP_HEALTH_ROUTES[$app]:-}" ]]; then needs_api=true; fi
      if [[ "${app}" != api && ! -f "${REPO_ROOT}/${APP_SOURCES[$app]}/dist/index.html" ]]; then
        echo "Missing built ${app} app in repository." >&2
        exit 1
      fi
    done
    if [[ "${needs_api}" == true ]]; then
      for entrypoint in index auth media; do
        [[ -f "${REPO_ROOT}/app/api/${entrypoint}.php" ]] || { echo "Missing API ${entrypoint}.php" >&2; exit 1; }
      done
      for app in "${WEB_APPS[@]}"; do
        if [[ -n "${APP_HEALTH_ROUTES[$app]}" && ! -f "${REPO_ROOT}/${APP_SOURCES[$app]}/server/entrypoint.php" ]]; then
          echo "Missing ${app} API entry point" >&2
          exit 1
        fi
      done
    fi
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs/postgresql' '$REMOTE_DIR/configs/nginx' '$REMOTE_DIR/configs/systemd' '$REMOTE_DIR/app/api'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" \
      "${REPO_ROOT}/scripts/deploy_web_app.sh" \
      "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    upload_script_lib
    upload_app_manifests
    upload_app_deploy_hooks
    if [[ "${needs_api}" == true ]]; then
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_nginx.sh" \
        "${REPO_ROOT}/scripts/deploy_api.sh" "${REPO_ROOT}/scripts/backup_postgresql.sh" \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/nginx/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/nginx/"
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/configs/postgresql/auth.sql" \
        "${REPO_ROOT}/configs/postgresql/media.sql" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/postgresql/"
      for app in "${WEB_APPS[@]}"; do
        [[ -n "${APP_HEALTH_ROUTES[$app]}" ]] || continue
        ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/server'"
        scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/${APP_SOURCES[$app]}/server/." \
          "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/server/"
      done
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    fi
    for app in "${SELECTED_APPS[@]}"; do
      [[ "${app}" == api ]] && continue
      ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/dist'"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/${APP_SOURCES[$app]}/dist/." \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/dist/"
    done
    ;;
  api-tests)
    load_app_registry "${REPO_ROOT}"
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/tests/api/cases'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/test_api.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/lib.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/backup_zip_stream.php" \
      "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/cases/"*.sh "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/cases/"
    for app in "${WEB_APPS[@]}"; do
      app_tests="${REPO_ROOT}/${APP_SOURCES[$app]}/tests"
      [[ -d "${app_tests}" ]] || continue
      ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/${APP_SOURCES[$app]}/tests' '$REMOTE_DIR/${APP_SOURCES[$app]}/server'"
      scp $SSH_OPTS -P "$PORT" -r "${app_tests}/." \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/tests/"
      if [[ -d "${REPO_ROOT}/${APP_SOURCES[$app]}/server" ]]; then
        scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/${APP_SOURCES[$app]}/server/." \
          "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/${APP_SOURCES[$app]}/server/"
      fi
    done
    ;;
  *)
    echo "Unknown mode: ${MODE}"
    echo "Expected one of: server, nginx, postgresql, apps, api-tests"
    exit 1
    ;;
esac
