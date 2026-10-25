#!/usr/bin/env bash

set -euo pipefail

: "${SERVER_HOST:?SERVER_HOST is required}"
: "${SERVER_SSH_KNOWN_HOSTS:?SERVER_SSH_KNOWN_HOSTS is required}"

SSH_CONFIG_DIR="${SSH_CONFIG_DIR:-${HOME}/.ssh}"
install -d -m 700 "${SSH_CONFIG_DIR}"
KEY_PATH="${SSH_KEY_PATH:-${SSH_CONFIG_DIR}/server_key}"
KNOWN_HOSTS_PATH="${SSH_CONFIG_DIR}/known_hosts"

if [[ -z "${SERVER_SSH_KEY_B64:-}" && -z "${SERVER_SSH_KEY:-}" ]]; then
  echo "Missing SSH key secret. Set SERVER_SSH_KEY_B64 (recommended) or SERVER_SSH_KEY."
  exit 1
fi

if [[ -n "${SERVER_SSH_KEY_B64:-}" ]]; then
  if ! printf '%s' "$SERVER_SSH_KEY_B64" | tr -d '\r\n ' | base64 -d > "$KEY_PATH" 2>/dev/null; then
    echo "SERVER_SSH_KEY_B64 is not valid base64-encoded private key content."
    exit 1
  fi
else
  printf '%s\n' "$SERVER_SSH_KEY" | tr -d '\r' > "$KEY_PATH"
fi

if [[ ! -s "$KEY_PATH" ]]; then
  echo "Decoded SSH key file is empty: $KEY_PATH"
  exit 1
fi

chmod 600 "$KEY_PATH"
if ! ssh-keygen -y -f "$KEY_PATH" >/dev/null 2>&1; then
  echo "Invalid SSH key secret. SERVER_SSH_KEY_B64 must be base64; SERVER_SSH_KEY must be raw multiline key content."
  exit 1
fi

PORT="${SERVER_PORT:-22}"
if [[ ! "${PORT}" =~ ^[0-9]+$ ]] || (( 10#${PORT} < 1 || 10#${PORT} > 65535 )); then
  echo "SERVER_PORT must be a valid TCP port."
  exit 1
fi
PORT="$((10#${PORT}))"

HOST_LOOKUP="${SERVER_HOST}"
if [[ "${PORT}" != 22 ]]; then
  HOST_LOOKUP="[${SERVER_HOST}]:${PORT}"
fi

candidate_hosts="$(mktemp "${SSH_CONFIG_DIR}/known_hosts.XXXXXXXX")"
trap 'rm -f -- "${candidate_hosts}"' EXIT
printf '%s\n' "${SERVER_SSH_KNOWN_HOSTS}" > "${candidate_hosts}"
if ! ssh-keygen -lf "${candidate_hosts}" >/dev/null 2>&1 \
  || ! ssh-keygen -F "${HOST_LOOKUP}" -f "${candidate_hosts}" >/dev/null 2>&1; then
  echo "SERVER_SSH_KNOWN_HOSTS must contain a valid host key for ${HOST_LOOKUP}."
  exit 1
fi
chmod 600 "${candidate_hosts}"
mv -f -- "${candidate_hosts}" "${KNOWN_HOSTS_PATH}"
