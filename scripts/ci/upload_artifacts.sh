#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/ci/upload_artifacts.sh <nginx|postgresql|apps|api-tests>"
  exit 1
fi

MODE="$1"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

: "${SERVER_HOST:?SERVER_HOST is required}"
: "${SERVER_USER:?SERVER_USER is required}"

source "${SCRIPT_DIR}/load_ssh_env.sh"

case "${MODE}" in
  nginx)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_nginx.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  postgresql)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/configs'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/setup_postgresql.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/configs/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/configs/"
    ;;
  apps)
    if [[ ! -d "${REPO_ROOT}/app" ]]; then
      echo "Missing app directory in repository."
      exit 1
    fi
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/app'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/provision.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts"/deploy_*.sh "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" -r "${REPO_ROOT}/app/." "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/app/"
    ;;
  api-tests)
    ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR/scripts' '$REMOTE_DIR/tests/api/cases'"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/scripts/test_api.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/scripts/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/lib.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/"
    scp $SSH_OPTS -P "$PORT" "${REPO_ROOT}/tests/api/cases/"*.sh "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/tests/api/cases/"
    ;;
  *)
    echo "Unknown mode: ${MODE}"
    echo "Expected one of: nginx, postgresql, apps, api-tests"
    exit 1
    ;;
esac
