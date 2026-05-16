PORT="${SERVER_PORT:-22}"
KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/server_key}"
SSH_OPTS="-i $KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
REMOTE_DIR="${REMOTE_DIR:-/tmp/workflow-artifacts}"
