#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: sudo bash scripts/setup_tls_certificate.sh <public-domain-or-ipv4>" >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash scripts/setup_tls_certificate.sh example.com)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/tls_certificate.sh"

identifier="${1,,}"
is_ipv4=false
if [[ "${identifier}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  IFS=. read -r octet1 octet2 octet3 octet4 <<< "${identifier}"
  for octet in "${octet1}" "${octet2}" "${octet3}" "${octet4}"; do
    if (( 10#${octet} > 255 )); then
      echo "Invalid IPv4 address: ${identifier}" >&2
      exit 1
    fi
  done
  is_ipv4=true
elif [[ ! "${identifier}" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ || "${identifier}" != *.* ]]; then
  echo "Provide one public DNS name or IPv4 address." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script requires Debian or Ubuntu with apt-get." >&2
  exit 1
fi
if [[ ! -d /var/www/home ]] || ! systemctl is-active --quiet nginx; then
  echo "Nginx must already serve /var/www/home over public HTTP on port 80." >&2
  exit 1
fi

echo "Installing a current Certbot release..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
if dpkg -s certbot >/dev/null 2>&1; then
  apt-get remove -y certbot
fi
apt-get install -y snapd
systemctl enable --now snapd.socket
if snap list certbot >/dev/null 2>&1; then
  snap refresh certbot
else
  snap install --classic certbot
fi
certbot_bin=/snap/bin/certbot
certbot_version="$("${certbot_bin}" --version | awk '{ print $2 }')"
if ! dpkg --compare-versions "${certbot_version}" ge 5.4; then
  echo "Certbot 5.4 or newer is required for IPv4 webroot certificates; found ${certbot_version}." >&2
  exit 1
fi

echo "Obtaining a certificate for ${identifier}..."
certbot_account_args=()
if [[ -n "${TLS_CONTACT_EMAIL:-}" ]]; then
  certbot_account_args=(--non-interactive --agree-tos --email "${TLS_CONTACT_EMAIL}")
fi
if [[ "${is_ipv4}" == true ]]; then
  "${certbot_bin}" certonly "${certbot_account_args[@]}" --webroot -w /var/www/home \
    --preferred-profile shortlived --ip-address "${identifier}" --cert-name "${identifier}"
else
  "${certbot_bin}" certonly "${certbot_account_args[@]}" --webroot -w /var/www/home \
    -d "${identifier}" --cert-name "${identifier}"
fi

tls_certificate_paths "https://${identifier}" || exit 1
cert_file="${TLS_CERT_FILE}"
key_file="${TLS_KEY_FILE}"
if [[ ! -r "${cert_file}" || ! -r "${key_file}" ]]; then
  echo "Certbot did not create the expected certificate files for ${identifier}." >&2
  exit 1
fi

hook_dir=/etc/letsencrypt/renewal-hooks/deploy
hook_file="${hook_dir}/softerr-reload-nginx.sh"
install -d -m 755 "${hook_dir}"
cat > "${hook_file}" <<'EOF'
#!/bin/sh
set -e
systemctl reload nginx
EOF
chmod 755 "${hook_file}"

if ! systemctl cat snap.certbot.renew.timer >/dev/null 2>&1; then
  echo "The Certbot snap renewal timer was not found." >&2
  exit 1
fi
systemctl enable --now snap.certbot.renew.timer

echo "Testing certificate renewal..."
"${certbot_bin}" renew --dry-run --non-interactive --cert-name "${identifier}"

echo "Certificate and renewal are ready for ${identifier}."
