#!/usr/bin/env bash

# Verify a public route through the local Nginx listener while preserving its
# configured Host header and TLS certificate check.
verify_local_app_route() {
  local route="$1" mode="$2" expected="${3:-}"
  local origin="${API_APP_BASE_URL:-}"
  local authority host url_port local_port response_file status attempt

  origin="${origin%/}"
  case "${origin}" in
    https://*) authority="${origin#https://}"; local_port=443 ;;
    http://*) authority="${origin#http://}"; local_port=80 ;;
    *) echo "API_APP_BASE_URL must be an HTTP or HTTPS origin." >&2; return 1 ;;
  esac
  authority="${authority%/}"
  if [[ "${authority}" == *:* ]]; then
    host="${authority%%:*}"
    url_port="${authority##*:}"
  else
    host="${authority}"
    url_port="${local_port}"
  fi
  if [[ ! "${host}" =~ ^[A-Za-z0-9.-]+$ || ! "${url_port}" =~ ^[0-9]+$ ]]; then
    echo "API_APP_BASE_URL must contain one host and optional port." >&2
    return 1
  fi

  response_file="$(mktemp)"
  for attempt in {1..6}; do
    status=""
    if status="$(curl -sS --noproxy '*' --connect-timeout 3 --max-time 10 \
      --output "${response_file}" --write-out '%{http_code}' \
      --connect-to "${host}:${url_port}:127.0.0.1:${local_port}" \
      "${origin}${route}")" && [[ "${status}" == 200 ]]; then
      case "${mode}" in
        api) if grep -Fq '"status":"ok"' "${response_file}"; then rm -f -- "${response_file}"; return 0; fi ;;
        file) if cmp -s -- "${response_file}" "${expected}"; then rm -f -- "${response_file}"; return 0; fi ;;
        *) echo "Unknown deployment check: ${mode}" >&2; rm -f -- "${response_file}"; return 1 ;;
      esac
    fi
    if (( attempt < 6 )); then sleep 2; fi
  done

  echo "Deployment route ${route} did not serve the expected response (HTTP ${status:-unavailable})." >&2
  if [[ -s "${response_file}" ]]; then
    head -c 500 "${response_file}" >&2
    echo >&2
  fi
  rm -f -- "${response_file}"
  return 1
}
