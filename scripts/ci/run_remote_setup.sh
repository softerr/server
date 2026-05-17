#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/ci/run_remote_setup.sh <remote-script-name>"
  echo "Example: bash scripts/ci/run_remote_setup.sh setup_nginx.sh"
  exit 1
fi

REMOTE_SCRIPT="$1"
if [[ ! "${REMOTE_SCRIPT}" =~ ^[A-Za-z0-9._-]+\.sh$ ]]; then
  echo "Invalid remote script name: ${REMOTE_SCRIPT}"
  exit 1
fi

: "${SERVER_HOST:?SERVER_HOST is required}"
: "${SERVER_USER:?SERVER_USER is required}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/load_ssh_env.sh"

required_csv="${REQUIRED_ENV_VARS:-}"
optional_csv="${OPTIONAL_ENV_VARS:-}"

split_csv() {
  local csv="$1"
  local -n out_arr="$2"
  out_arr=()
  if [[ -z "${csv}" ]]; then
    return
  fi

  local normalized="${csv//,/ }"
  local entry
  for entry in ${normalized}; do
    if [[ -n "${entry}" ]]; then
      out_arr+=("${entry}")
    fi
  done
}

required_vars=()
optional_vars=()
split_csv "${required_csv}" required_vars
split_csv "${optional_csv}" optional_vars

validate_var_name() {
  local name="$1"
  [[ "${name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

all_vars=()
for var_name in "${required_vars[@]}"; do
  if ! validate_var_name "${var_name}"; then
    echo "Invalid required env var name: ${var_name}"
    exit 1
  fi
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: ${var_name}"
    exit 1
  fi
  all_vars+=("${var_name}")
done

for var_name in "${optional_vars[@]}"; do
  if ! validate_var_name "${var_name}"; then
    echo "Invalid optional env var name: ${var_name}"
    exit 1
  fi
  if [[ " ${all_vars[*]} " != *" ${var_name} "* ]]; then
    all_vars+=("${var_name}")
  fi
done

remote_assignments=()
for var_name in "${all_vars[@]}"; do
  var_value="${!var_name:-}"
  var_b64="$(printf '%s' "${var_value}" | base64 -w 0)"
  remote_assignments+=("${var_name}_B64='${var_b64}'")
done

if [[ "${#remote_assignments[@]}" -eq 0 ]]; then
  remote_env_prefix=""
else
  remote_env_prefix="${remote_assignments[*]} "
fi

preserve_csv=""
if [[ "${#all_vars[@]}" -gt 0 ]]; then
  preserve_csv="$(IFS=,; printf '%s' "${all_vars[*]}")"
fi

all_vars_csv=""
if [[ "${#all_vars[@]}" -gt 0 ]]; then
  all_vars_csv="$(IFS=,; printf '%s' "${all_vars[*]}")"
fi

ssh $SSH_OPTS -p "$PORT" "$SERVER_USER@$SERVER_HOST" "${remote_env_prefix}REMOTE_DIR='${REMOTE_DIR}' REMOTE_SCRIPT='${REMOTE_SCRIPT}' ALL_VARS_CSV='${all_vars_csv}' PRESERVE_VARS='${preserve_csv}' bash -s" <<'EOF'
set -euo pipefail

if [[ -n "${ALL_VARS_CSV}" ]]; then
  all_vars_normalized="${ALL_VARS_CSV//,/ }"
  for var_name in ${all_vars_normalized}; do
    [[ -z "${var_name}" ]] && continue
    b64_var="${var_name}_B64"
    decoded_value="$(printf '%s' "${!b64_var}" | base64 -d)"
    printf -v "${var_name}" '%s' "${decoded_value}"
    export "${var_name}"
  done
fi

remote_script_path="${REMOTE_DIR}/scripts/${REMOTE_SCRIPT}"
chmod +x "${remote_script_path}"

if [[ -n "${PRESERVE_VARS}" ]]; then
  sudo --preserve-env="${PRESERVE_VARS}" bash "${remote_script_path}"
else
  sudo bash "${remote_script_path}"
fi
EOF
