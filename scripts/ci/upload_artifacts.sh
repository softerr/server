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

case "${MODE}" in
  server)
    if [[ ! -f "${REPO_ROOT}/app/api/index.php" || ! -f "${REPO_ROOT}/app/quiz/dist/index.html" ]]; then
      echo "Build the quiz and include the API before first-time setup."
      exit 1
    fi
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs' '$REMOTE_DIR/app/api' '$REMOTE_DIR/app/quiz/dist'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "${REPO_ROOT}/scripts/setup_server.sh" \
      "${REPO_ROOT}/scripts/setup_tls_certificate.sh" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" \
      "${REPO_ROOT}/scripts/setup_nginx.sh" "${REPO_ROOT}/scripts/deploy_api.sh" \
      "${REPO_ROOT}/scripts/deploy_quiz.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/atomic_deploy.sh" \
      "${REPO_ROOT}/scripts/lib/tls_certificate.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/quiz/dist/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/quiz/dist/"
    ;;
  nginx)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_nginx.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/tls_certificate.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  postgresql)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_postgresql.sh" \
      "${REPO_ROOT}/scripts/backup_postgresql.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  apps)
    app_list="${APP_LIST:-all}"
    case "${app_list}" in
      all|api|quiz) ;;
      *) echo "Invalid APP_LIST: ${app_list}"; exit 1 ;;
    esac

    if [[ "${app_list}" == "all" || "${app_list}" == "api" ]] && [[ ! -f "${REPO_ROOT}/app/api/index.php" ]]; then
      echo "Missing app/api/index.php in repository."
      exit 1
    fi
    if [[ "${app_list}" == "all" || "${app_list}" == "quiz" ]] && [[ ! -f "${REPO_ROOT}/app/quiz/dist/index.html" ]]; then
      echo "Missing built app/quiz/dist/index.html in repository."
      exit 1
    fi

    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_DIR/scripts/lib' '$REMOTE_DIR/app/api' '$REMOTE_DIR/app/quiz/dist'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/lib/atomic_deploy.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/lib/"
    if [[ "${app_list}" == "all" || "${app_list}" == "api" ]]; then
      scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/deploy_api.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
      scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/api/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/api/"
    fi
    if [[ "${app_list}" == "all" || "${app_list}" == "quiz" ]]; then
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
