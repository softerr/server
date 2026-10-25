#!/usr/bin/env bash

set -euo pipefail

: "${SERVER_HOST:?SERVER_HOST is required}"

mkdir -p ~/.ssh
KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/server_key}"

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
if ! ssh-keyscan -p "$PORT" -H "$SERVER_HOST" >> ~/.ssh/known_hosts 2>/dev/null; then
  echo "Failed to fetch host key for ${SERVER_HOST}:${PORT} via ssh-keyscan."
  exit 1
fi
