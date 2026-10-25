PORT="${SERVER_PORT:-22}"
KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/server_key}"
SSH_OPTS="-i $KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
if [[ -z "${REMOTE_DIR:-}" && -n "${GITHUB_RUN_ID:-}" ]]; then
  REMOTE_DIR="/tmp/workflow-artifacts/runs/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
else
  REMOTE_DIR="${REMOTE_DIR:-/tmp/workflow-artifacts}"
fi

if [[ ! "${REMOTE_DIR}" =~ ^/[A-Za-z0-9_./-]+$ || "${REMOTE_DIR}" == "/" || "${REMOTE_DIR}" == *"/../"* || "${REMOTE_DIR}" == *"/./"* || "${REMOTE_DIR}" == *"/.." || "${REMOTE_DIR}" == *"/." ]]; then
  echo "REMOTE_DIR must be an absolute path without spaces or shell metacharacters." >&2
  exit 1
fi
