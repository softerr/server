#!/usr/bin/env bash

tls_certificate_paths() {
  local origin="${1%/}"
  if [[ ! "${origin}" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
    echo "API_APP_BASE_URL must be one HTTPS origin with a domain or public IPv4 address." >&2
    return 1
  fi

  TLS_ORIGIN="${origin}"
  TLS_HOST="${origin#https://}"
  TLS_CERT_FILE="/etc/letsencrypt/live/${TLS_HOST}/fullchain.pem"
  TLS_KEY_FILE="/etc/letsencrypt/live/${TLS_HOST}/privkey.pem"
}

tls_certificate_valid() {
  local host="$1"
  local cert_file="$2"
  local key_file="$3"
  local check_option expected_host_check host_check cert_public_key private_public_key

  if [[ ! -r "${cert_file}" || ! -r "${key_file}" ]]; then
    echo "TLS certificate and key for API_APP_BASE_URL are missing or unreadable." >&2
    return 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "OpenSSL is required to validate the TLS certificate." >&2
    return 1
  fi
  if [[ "${host}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    check_option=-checkip
    expected_host_check="IP ${host} does match certificate"
  else
    check_option=-checkhost
    expected_host_check="Hostname ${host} does match certificate"
  fi
  # openssl x509 -checkhost can exit successfully even when it prints a mismatch.
  if ! host_check="$(openssl x509 -in "${cert_file}" -noout "${check_option}" "${host}")" \
    || [[ "${host_check}" != "${expected_host_check}" ]]; then
    echo "TLS certificate does not match the API_APP_BASE_URL host." >&2
    return 1
  fi
  if ! openssl x509 -in "${cert_file}" -noout -checkend 0 >/dev/null; then
    echo "TLS certificate is expired." >&2
    return 1
  fi
  if ! cert_public_key="$(openssl x509 -in "${cert_file}" -pubkey -noout)" \
    || ! private_public_key="$(openssl pkey -in "${key_file}" -pubout -passin pass:)" \
    || [[ "${cert_public_key}" != "${private_public_key}" ]]; then
    echo "TLS private key does not match the certificate." >&2
    return 1
  fi
}
