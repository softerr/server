#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash bootstrap_server.sh YOUR_PUBLIC_IP you@example.com)." >&2
  exit 1
fi
if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: sudo bash bootstrap_server.sh <public-domain-or-ipv4> <certificate-email> [ssh-port]" >&2
  exit 1
fi

public_host="${1,,}"
contact_email="$2"
ssh_port="${3:-22}"

if [[ "${public_host}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  IFS=. read -r octet1 octet2 octet3 octet4 <<< "${public_host}"
  for octet in "${octet1}" "${octet2}" "${octet3}" "${octet4}"; do
    if (( 10#${octet} > 255 )); then
      echo "Invalid public IPv4 address: ${public_host}" >&2
      exit 1
    fi
  done
elif [[ ! "${public_host}" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ || "${public_host}" != *.* ]]; then
  echo "Provide one public DNS name or IPv4 address." >&2
  exit 1
fi
if [[ ! "${contact_email}" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]]; then
  echo "Provide a valid certificate contact email address." >&2
  exit 1
fi
if [[ ! "${ssh_port}" =~ ^[0-9]+$ ]] || (( 10#${ssh_port} < 1 || 10#${ssh_port} > 65535 )); then
  echo "SSH port must be between 1 and 65535." >&2
  exit 1
fi
ssh_port="$((10#${ssh_port}))"
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script requires Debian or Ubuntu with apt-get." >&2
  exit 1
fi

if ! command -v sshd >/dev/null 2>&1 || ! command -v ssh-keygen >/dev/null 2>&1 \
  || ! command -v openssl >/dev/null 2>&1 || ! command -v visudo >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y openssh-server openssh-client openssl sudo
fi
systemctl enable --now ssh

workflow_user=github-workflow
private_key=/root/.ssh/github-workflow_github_actions_ed25519
public_key_file="${private_key}.pub"
install -d -m 700 /root/.ssh
if [[ ! -f "${private_key}" ]]; then
  ssh-keygen -t ed25519 -N '' -C "${workflow_user}@github-actions" -f "${private_key}" >/dev/null
fi
chmod 600 "${private_key}"
ssh-keygen -y -f "${private_key}" > "${public_key_file}"
public_key="$(cat "${public_key_file}")"
if [[ -z "${public_key}" ]]; then
  echo "Generated workflow public key is empty." >&2
  exit 1
fi

if ! id -u "${workflow_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${workflow_user}"
fi
ssh_dir="/home/${workflow_user}/.ssh"
authorized_keys="${ssh_dir}/authorized_keys"
install -d -m 700 -o "${workflow_user}" -g "${workflow_user}" "${ssh_dir}"
touch "${authorized_keys}"
chown "${workflow_user}:${workflow_user}" "${authorized_keys}"
chmod 600 "${authorized_keys}"
if ! grep -Fxq "${public_key}" "${authorized_keys}"; then
  printf '%s\n' "${public_key}" >> "${authorized_keys}"
fi

sudoers_file="/etc/sudoers.d/${workflow_user}-workflow-scripts"
tmp_sudoers="$(mktemp)"
trap 'rm -f -- "${tmp_sudoers}"' EXIT
cat > "${tmp_sudoers}" <<EOF
${workflow_user} ALL=(root) NOPASSWD:SETENV: /bin/bash /tmp/workflow-artifacts/runs/*/scripts/*.sh, /usr/bin/bash /tmp/workflow-artifacts/runs/*/scripts/*.sh
EOF
visudo -cf "${tmp_sudoers}" >/dev/null
install -o root -g root -m 440 "${tmp_sudoers}" "${sudoers_file}"
rm -f -- "${tmp_sudoers}"
trap - EXIT

host_key=/etc/ssh/ssh_host_ed25519_key.pub
password_file=/etc/softerr/bootstrap-db-password
if [[ ! -r "${private_key}" || ! -r "${host_key}" ]]; then
  echo "Deployment or SSH host key is missing after SSH setup." >&2
  exit 1
fi

install -d -m 755 /etc/softerr
if [[ ! -s "${password_file}" ]]; then
  umask 077
  openssl rand -hex 32 > "${password_file}"
fi
chmod 600 "${password_file}"
db_password="$(cat "${password_file}")"
if [[ ! "${db_password}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Stored database password is invalid: ${password_file}" >&2
  exit 1
fi

read -r key_type key_value _ < "${host_key}"
if [[ "${key_type}" != ssh-ed25519 || -z "${key_value}" ]]; then
  echo "Expected an Ed25519 SSH host key in ${host_key}." >&2
  exit 1
fi
known_host="${public_host}"
if [[ "${ssh_port}" != 22 ]]; then
  known_host="[${public_host}]:${ssh_port}"
fi

echo
echo "Add these to the GitHub production environment, then run Actions -> Set Up Server."
echo "The SSH private key below grants effective root access through the workflow user."
echo
echo "Secrets:"
printf 'SERVER_HOST=%s\n' "${public_host}"
printf 'SERVER_USER=%s\n' 'github-workflow'
printf 'SERVER_PORT=%s\n' "${ssh_port}"
printf 'SERVER_SSH_KEY_B64=%s\n' "$(base64 -w 0 "${private_key}")"
printf 'SERVER_SSH_KNOWN_HOSTS=%s %s %s\n' "${known_host}" "${key_type}" "${key_value}"
printf 'POSTGRES_AUTH_API_PASSWORD=%s\n' "${db_password}"
printf 'API_DB_PASSWORD=%s\n' "${db_password}"
echo
echo "Variables:"
printf 'API_APP_BASE_URL=https://%s\n' "${public_host}"
printf 'TLS_CONTACT_EMAIL=%s\n' "${contact_email}"
echo
echo "Verification email also needs your SMTP provider settings (API_MAIL_FROM and API_SMTP_* secrets)."
echo "If these are omitted, the server must already have a working local mail transport."
echo
echo "SSH host key fingerprint (verify if transferring these values elsewhere):"
ssh-keygen -lf "${host_key}" -E sha256
