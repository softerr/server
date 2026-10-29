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

case "${MODE}" in
  server)
    if [[ ! -f "${REPO_ROOT}/app/api/index.php" || ! -f "${REPO_ROOT}/app/api/auth.php" \
      || ! -f "${REPO_ROOT}/app/api/quiz.php" || ! -f "${REPO_ROOT}/app/api/media.php" || ! -f "${REPO_ROOT}/app/home/dist/index.html" \
      || ! -f "${REPO_ROOT}/app/quiz/dist/index.html" ]]; then
      echo "Build home and quiz and include the API before first-time setup."
      exit 1
    fi
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs' '$REMOTE_DIR/app/api' '$REMOTE_DIR/app/home/dist' '$REMOTE_DIR/app/quiz/dist'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "${REPO_ROOT}/scripts/setup_server.sh" \
      "${REPO_ROOT}/scripts/setup_tls_certificate.sh" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" \
      "${REPO_ROOT}/scripts/setup_php_fpm.sh" "${REPO_ROOT}/scripts/setup_email_worker.sh" \
      "${REPO_ROOT}/scripts/setup_nginx.sh" "${REPO_ROOT}/scripts/deploy_api.sh" \
      "${REPO_ROOT}/scripts/deploy_home.sh" \
      "${REPO_ROOT}/scripts/deploy_quiz.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/atomic_deploy.sh" \
      "${REPO_ROOT}/scripts/lib/app_selection.sh" \
      "${REPO_ROOT}/scripts/lib/apt_locks.sh" \
      "${REPO_ROOT}/scripts/lib/api_env.sh" \
      "${REPO_ROOT}/scripts/lib/deploy_checks.sh" \
      "${REPO_ROOT}/scripts/lib/tls_certificate.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/home/dist/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/home/dist/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/quiz/dist/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/quiz/dist/"
    ;;
  nginx)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_php_fpm.sh" \
      "${REPO_ROOT}/scripts/setup_email_worker.sh" \
      "${REPO_ROOT}/scripts/setup_nginx.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/apt_locks.sh" \
      "${REPO_ROOT}/scripts/lib/api_env.sh" \
      "${REPO_ROOT}/scripts/lib/tls_certificate.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  postgresql)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/apt_locks.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  apps)
    select_apps "${APP_LIST:-all}"

    if app_selected api; then
      for entrypoint in index auth quiz media; do
        if [[ ! -f "${REPO_ROOT}/app/api/${entrypoint}.php" ]]; then
          echo "Missing app/api/${entrypoint}.php in repository."
          exit 1
        fi
      done
    fi
    if app_selected home && [[ ! -f "${REPO_ROOT}/app/home/dist/index.html" ]]; then
      echo "Missing built app/home/dist/index.html in repository."
      exit 1
    fi
    if app_selected quiz && [[ ! -f "${REPO_ROOT}/app/quiz/dist/index.html" ]]; then
      echo "Missing built app/quiz/dist/index.html in repository."
      exit 1
    fi

    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs/postgresql' '$REMOTE_DIR/configs/systemd' '$REMOTE_DIR/app/api' '$REMOTE_DIR/app/home/dist' '$REMOTE_DIR/app/quiz/dist'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/atomic_deploy.sh" \
      "${REPO_ROOT}/scripts/lib/app_selection.sh" \
      "${REPO_ROOT}/scripts/lib/deploy_checks.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    if app_selected api; then
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/configs/postgresql/quiz.sql" \
        "${REPO_ROOT}/configs/postgresql/media.sql" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/postgresql/"
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/configs/systemd/softerr-recover-quiz-imports.service" \
        "${REPO_ROOT}/configs/systemd/softerr-recover-quiz-imports.timer" \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/systemd/"
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/deploy_api.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    fi
    if app_selected home; then
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/deploy_home.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/home/dist/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/home/dist/"
    fi
    if app_selected quiz; then
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/deploy_quiz.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/quiz/dist/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/quiz/dist/"
    fi
    ;;
  api-tests)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/tests/api/cases'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/test_api.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/lib.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/cases/"*.sh "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/cases/"
    ;;
  *)
    echo "Unknown mode: ${MODE}"
    echo "Expected one of: server, nginx, postgresql, apps, api-tests"
    exit 1
    ;;
esac
