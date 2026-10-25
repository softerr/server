PORT="${SERVER_PORT:-22}"
SSH_CONFIG_DIR="${SSH_CONFIG_DIR:-${HOME}/.ssh}"
KEY_PATH="${SSH_KEY_PATH:-${SSH_CONFIG_DIR}/server_key}"
SSH_OPTS="-i $KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${SSH_CONFIG_DIR}/known_hosts"
if [[ -z "${REMOTE_DIR:-}" ]]; then
  if [[ -z "${GITHUB_RUN_ID:-}" ]]; then
    echo "REMOTE_DIR is required outside GitHub Actions; use a unique run directory." >&2
    exit 1
  fi
  REMOTE_DIR="/tmp/workflow-artifacts/runs/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
fi

if [[ ! "${REMOTE_DIR}" =~ ^/[A-Za-z0-9_./-]+$ || "${REMOTE_DIR}" == "/" || "${REMOTE_DIR}" == *"/../"* || "${REMOTE_DIR}" == *"/./"* || "${REMOTE_DIR}" == *"/.." || "${REMOTE_DIR}" == *"/." ]]; then
  echo "REMOTE_DIR must be an absolute path without spaces or shell metacharacters." >&2
  exit 1
fi
