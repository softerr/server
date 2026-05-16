#!/usr/bin/env bash

set -euo pipefail

: "${SERVER_HOST:?SERVER_HOST is required}"

mkdir -p ~/.ssh
KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/server_key}"

if [[ -n "${SERVER_SSH_KEY_B64:-}" ]]; then
  printf '%s' "$SERVER_SSH_KEY_B64" | tr -d '\r\n ' | base64 -d > "$KEY_PATH"
else
  RAW_KEY="$(printf '%s' "${SERVER_SSH_KEY:-}" | tr -d '\r')"
  RAW_KEY="${RAW_KEY#\"}"
  RAW_KEY="${RAW_KEY%\"}"
  RAW_KEY="${RAW_KEY#\'}"
  RAW_KEY="${RAW_KEY%\'}"

  if [[ "$RAW_KEY" == *"BEGIN "*"PRIVATE KEY"* ]]; then
    RAW_KEY="${RAW_KEY//\\n/$'\n'}"
    printf '%s' "$RAW_KEY" > "$KEY_PATH"
  else
    printf '%s' "$RAW_KEY" | tr -d '\n ' | base64 -d > "$KEY_PATH"
  fi
fi

chmod 600 "$KEY_PATH"
if ! ssh-keygen -y -f "$KEY_PATH" >/dev/null 2>&1; then
  echo "Invalid SSH key secret. Set SERVER_SSH_KEY_B64 (recommended) or SERVER_SSH_KEY."
  exit 1
fi

PORT="${SERVER_PORT:-22}"
ssh-keyscan -p "$PORT" -H "$SERVER_HOST" >> ~/.ssh/known_hosts
