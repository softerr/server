#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/tls_certificate.sh"

test_dir="$(mktemp -d)"
trap 'rm -rf -- "${test_dir}"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=example.test' \
  -keyout "${test_dir}/key.pem" -out "${test_dir}/cert.pem" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=other.test' \
  -keyout "${test_dir}/other-key.pem" -out "${test_dir}/other-cert.pem" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout "${test_dir}/ip-key.pem" -out "${test_dir}/ip-cert.pem" >/dev/null 2>&1

tls_certificate_paths 'https://example.test/'
[[ "${TLS_ORIGIN}" == 'https://example.test' ]]
[[ "${TLS_HOST}" == 'example.test' ]]
tls_certificate_valid 'example.test' "${test_dir}/cert.pem" "${test_dir}/key.pem"
tls_certificate_valid '127.0.0.1' "${test_dir}/ip-cert.pem" "${test_dir}/ip-key.pem"

if tls_certificate_valid 'other.test' "${test_dir}/cert.pem" "${test_dir}/key.pem" >/dev/null 2>&1; then
  echo "Accepted a certificate for the wrong host." >&2
  exit 1
fi
if tls_certificate_valid 'example.test' "${test_dir}/cert.pem" "${test_dir}/other-key.pem" >/dev/null 2>&1; then
  echo "Accepted a certificate with the wrong private key." >&2
  exit 1
fi
if tls_certificate_paths 'http://example.test' >/dev/null 2>&1; then
  echo "Accepted a public HTTP origin." >&2
  exit 1
fi

echo "TLS certificate checks passed."
