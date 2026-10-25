#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo bash scripts/create_github_workflow_user.sh [options]

Options:
  --user <name>             SSH user to create (default: github-workflow)
  --pubkey <key>            Public key content (optional override)
  --pubkey-file <path>      Path to public key file (optional override)
  --scripts-dir <path>      Directory of staged scripts (default: /tmp/workflow-artifacts)
  -h, --help                Show help

No-argument mode:
  Generates or reuses a dedicated deployment keypair under /root/.ssh/.
  This key grants effective root access because its user can upload scripts run with sudo.
EOF
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

WORKFLOW_USER="github-workflow"
SCRIPTS_DIR="/tmp/workflow-artifacts"
PUBLIC_KEY=""
PUBLIC_KEY_FILE=""
GENERATED_PRIVATE_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      WORKFLOW_USER="${2:-}"
      shift 2
      ;;
    --pubkey)
      PUBLIC_KEY="${2:-}"
      shift 2
      ;;
    --pubkey-file)
      PUBLIC_KEY_FILE="${2:-}"
      shift 2
      ;;
    --scripts-dir)
      SCRIPTS_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${WORKFLOW_USER}" ]]; then
  echo "--user cannot be empty."
  exit 1
fi

if [[ -n "${PUBLIC_KEY_FILE}" ]]; then
  if [[ ! -f "${PUBLIC_KEY_FILE}" ]]; then
    echo "Public key file not found: ${PUBLIC_KEY_FILE}"
    exit 1
  fi
  PUBLIC_KEY="$(cat "${PUBLIC_KEY_FILE}")"
fi

if [[ -z "${PUBLIC_KEY}" ]]; then
  install -d -m 700 /root/.ssh
  GEN_BASE="/root/.ssh/${WORKFLOW_USER}_github_actions_ed25519"
  if [[ ! -f "${GEN_BASE}" ]]; then
    ssh-keygen -t ed25519 -N "" -C "${WORKFLOW_USER}@github-actions" -f "${GEN_BASE}" >/dev/null
    echo "Generated new keypair: ${GEN_BASE}"
  else
    echo "Reusing existing generated keypair: ${GEN_BASE}"
  fi
  if [[ ! -f "${GEN_BASE}.pub" ]]; then
    ssh-keygen -y -f "${GEN_BASE}" > "${GEN_BASE}.pub"
  fi
  PUBLIC_KEY="$(cat "${GEN_BASE}.pub")"
  GENERATED_PRIVATE_KEY="${GEN_BASE}"
fi

if [[ "${SCRIPTS_DIR}" != /* ]]; then
  echo "--scripts-dir must be an absolute path."
  exit 1
fi

if [[ "${SCRIPTS_DIR}" =~ [[:space:]] ]]; then
  echo "--scripts-dir must not contain spaces."
  exit 1
fi

if id -u "${WORKFLOW_USER}" >/dev/null 2>&1; then
  echo "User already exists: ${WORKFLOW_USER}"
else
  useradd --create-home --shell /bin/bash "${WORKFLOW_USER}"
  echo "Created user: ${WORKFLOW_USER}"
fi

SSH_DIR="/home/${WORKFLOW_USER}/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"
install -d -m 700 -o "${WORKFLOW_USER}" -g "${WORKFLOW_USER}" "${SSH_DIR}"
touch "${AUTH_KEYS}"
chown "${WORKFLOW_USER}:${WORKFLOW_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

if grep -Fxq "${PUBLIC_KEY}" "${AUTH_KEYS}"; then
  echo "Public key already exists in ${AUTH_KEYS}"
else
  printf '%s\n' "${PUBLIC_KEY}" >> "${AUTH_KEYS}"
  echo "Added public key to ${AUTH_KEYS}"
fi

SUDOERS_FILE="/etc/sudoers.d/${WORKFLOW_USER}-workflow-scripts"
TMP_SUDOERS="$(mktemp)"
cat > "${TMP_SUDOERS}" <<EOF
${WORKFLOW_USER} ALL=(root) NOPASSWD:SETENV: /bin/bash ${SCRIPTS_DIR}/scripts/*.sh, /usr/bin/bash ${SCRIPTS_DIR}/scripts/*.sh, /bin/bash ${SCRIPTS_DIR}/runs/*/scripts/*.sh, /usr/bin/bash ${SCRIPTS_DIR}/runs/*/scripts/*.sh
EOF

if command -v visudo >/dev/null 2>&1; then
  visudo -cf "${TMP_SUDOERS}" >/dev/null
fi

install -o root -g root -m 440 "${TMP_SUDOERS}" "${SUDOERS_FILE}"
rm -f "${TMP_SUDOERS}"

echo "Configured sudoers: ${SUDOERS_FILE}"
echo "User '${WORKFLOW_USER}' can run:"
echo "  sudo bash ${SCRIPTS_DIR}/scripts/<script>.sh"
echo "  sudo bash ${SCRIPTS_DIR}/runs/<run-id>-<attempt>/scripts/<script>.sh"
echo "This SSH key grants effective root access: the user can upload scripts that sudo runs as root."

if [[ -n "${GENERATED_PRIVATE_KEY}" ]]; then
  echo
  echo "Set GitHub secret SERVER_SSH_KEY to the private key content from:"
  echo "  ${GENERATED_PRIVATE_KEY}"
  echo
  echo "Command to print it:"
  echo "  cat ${GENERATED_PRIVATE_KEY}"
  echo
  echo "Recommended: set SERVER_SSH_KEY_B64 with:"
  echo "  base64 -w 0 ${GENERATED_PRIVATE_KEY}"
fi
