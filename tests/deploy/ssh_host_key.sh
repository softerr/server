#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

ssh-keygen -q -t ed25519 -N '' -f "${TEST_ROOT}/test_key"
read -r key_type key_value _ < "${TEST_ROOT}/test_key.pub"

export SERVER_HOST=example.test
export SERVER_PORT=2222
export SERVER_SSH_KEY_B64
export SERVER_SSH_KNOWN_HOSTS
export SSH_CONFIG_DIR="${TEST_ROOT}/ssh"
SERVER_SSH_KEY_B64="$(base64 -w 0 "${TEST_ROOT}/test_key")"
SERVER_SSH_KNOWN_HOSTS="[example.test]:2222 ${key_type} ${key_value}"

bash "${REPO_ROOT}/scripts/ci/configure_ssh_for_actions.sh"
ssh-keygen -F '[example.test]:2222' -f "${SSH_CONFIG_DIR}/known_hosts" >/dev/null
[[ "$(stat -c %a "${SSH_CONFIG_DIR}/known_hosts")" == 600 ]]

SERVER_SSH_KNOWN_HOSTS="[other.test]:2222 ${key_type} ${key_value}"
if bash "${REPO_ROOT}/scripts/ci/configure_ssh_for_actions.sh" >/dev/null 2>&1; then
  echo "Accepted a host key for the wrong host."
  exit 1
fi
ssh-keygen -F '[example.test]:2222' -f "${SSH_CONFIG_DIR}/known_hosts" >/dev/null

SERVER_SSH_KNOWN_HOSTS="example.test ${key_type} ${key_value}"
if bash "${REPO_ROOT}/scripts/ci/configure_ssh_for_actions.sh" >/dev/null 2>&1; then
  echo "Accepted a port-22 host key for port 2222."
  exit 1
fi

unset SERVER_SSH_KNOWN_HOSTS
if bash "${REPO_ROOT}/scripts/ci/configure_ssh_for_actions.sh" >/dev/null 2>&1; then
  echo "Accepted a missing trusted host key."
  exit 1
fi

echo "Pinned SSH host key checks passed."
