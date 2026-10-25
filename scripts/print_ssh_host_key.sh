#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: bash scripts/print_ssh_host_key.sh <SERVER_HOST> [SERVER_PORT]" >&2
  exit 1
fi

ssh_host="$1"
ssh_port="${2:-22}"
host_key_file=/etc/ssh/ssh_host_ed25519_key.pub

if [[ ! "${ssh_host}" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "SERVER_HOST must be a hostname or IP address without spaces." >&2
  exit 1
fi
if [[ ! "${ssh_port}" =~ ^[0-9]+$ ]] || (( 10#${ssh_port} < 1 || 10#${ssh_port} > 65535 )); then
  echo "SERVER_PORT must be a valid TCP port." >&2
  exit 1
fi
ssh_port="$((10#${ssh_port}))"

if [[ ! -r "${host_key_file}" ]]; then
  echo "Cannot read SSH host public key: ${host_key_file}" >&2
  exit 1
fi
if ! read -r key_type key_value _ < "${host_key_file}" \
  || [[ "${key_type}" != ssh-ed25519 || -z "${key_value}" ]]; then
  echo "Expected an Ed25519 SSH host public key in ${host_key_file}." >&2
  exit 1
fi
if ! fingerprint="$(ssh-keygen -lf "${host_key_file}" -E sha256)"; then
  echo "Could not verify SSH host public key: ${host_key_file}" >&2
  exit 1
fi

known_host="${ssh_host}"
if [[ "${ssh_port}" != 22 ]]; then
  known_host="[${ssh_host}]:${ssh_port}"
fi

echo "Copy this line into the production environment secret SERVER_SSH_KNOWN_HOSTS:"
printf '%s %s %s\n' "${known_host}" "${key_type}" "${key_value}"
echo
echo "Server host key SHA256 fingerprint:"
printf '%s\n' "${fingerprint}"
