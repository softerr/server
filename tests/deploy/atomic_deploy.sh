#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

SOURCE_OLD="${TEST_ROOT}/old"
SOURCE_NEW="${TEST_ROOT}/new"
LIVE="${TEST_ROOT}/live"
mkdir -p "${SOURCE_OLD}" "${SOURCE_NEW}/assets"
printf 'old\n' > "${SOURCE_OLD}/index.html"
printf 'old asset\n' > "${SOURCE_OLD}/removed.js"
printf 'new\n' > "${SOURCE_NEW}/index.html"
printf 'new asset\n' > "${SOURCE_NEW}/assets/app.js"

WEB_USER="$(id -un)"
WEB_GROUP="$(id -gn)"

deploy() {
  bash -c 'source "$1"; atomic_deploy_dir "$2" "$3" "$4" "$5"' bash \
    "${REPO_ROOT}/scripts/lib/atomic_deploy.sh" "$1" "${LIVE}" "$2" "${WEB_GROUP}"
}

deploy "${SOURCE_OLD}" "${WEB_USER}"
[[ "$(cat "${LIVE}/index.html")" == old ]]
[[ -f "${LIVE}/removed.js" ]]

deploy "${SOURCE_NEW}" "${WEB_USER}"
[[ "$(cat "${LIVE}/index.html")" == new ]]
[[ -f "${LIVE}/assets/app.js" ]]
[[ ! -e "${LIVE}/removed.js" ]]

[[ "$(stat -c %a "${LIVE}")" == 755 ]]
[[ "$(stat -c %a "${LIVE}/index.html")" == 644 ]]

source "${REPO_ROOT}/scripts/lib/atomic_deploy.sh"
reject_release() { return 1; }
FIRST_LIVE="${TEST_ROOT}/first"
if atomic_deploy_dir "${SOURCE_NEW}" "${FIRST_LIVE}" "${WEB_USER}" "${WEB_GROUP}" reject_release > /dev/null 2>&1; then
  echo "Failed first-release verification unexpectedly succeeded."
  exit 1
fi
[[ ! -e "${FIRST_LIVE}" ]]
accept_release() { [[ "$(cat "${FIRST_LIVE}/index.html")" == new ]]; }
atomic_deploy_dir "${SOURCE_NEW}" "${FIRST_LIVE}" "${WEB_USER}" "${WEB_GROUP}" accept_release
[[ "$(cat "${FIRST_LIVE}/index.html")" == new ]]
if atomic_deploy_dir "${SOURCE_OLD}" "${LIVE}" "${WEB_USER}" "${WEB_GROUP}" reject_release > /dev/null 2>&1; then
  echo "Failed verification unexpectedly kept the new release."
  exit 1
fi
[[ "$(cat "${LIVE}/index.html")" == new ]]
[[ -f "${LIVE}/assets/app.js" ]]
[[ ! -e "${LIVE}/removed.js" ]]

interrupt_release() { kill -TERM "${BASHPID}"; }
if atomic_deploy_dir "${SOURCE_OLD}" "${LIVE}" "${WEB_USER}" "${WEB_GROUP}" interrupt_release > /dev/null 2>&1; then
  echo "Interrupted verification unexpectedly kept the new release."
  exit 1
fi
[[ "$(cat "${LIVE}/index.html")" == new ]]

INVALID_USER="missing-deploy-owner-$$"
if id -u "${INVALID_USER}" >/dev/null 2>&1; then
  echo "Unexpected test account exists: ${INVALID_USER}"
  exit 1
fi
if deploy "${SOURCE_OLD}" "${INVALID_USER}" > /dev/null 2>&1; then
  echo "Invalid owner unexpectedly replaced the live app."
  exit 1
fi
[[ "$(cat "${LIVE}/index.html")" == new ]]

if deploy "${TEST_ROOT}/missing" "${WEB_USER}" > /dev/null 2>&1; then
  echo "Missing source unexpectedly replaced the live app."
  exit 1
fi
[[ "$(cat "${LIVE}/index.html")" == new ]]

if compgen -G "${TEST_ROOT}/.live.next.*" > /dev/null \
  || compgen -G "${TEST_ROOT}/.first.next.*" > /dev/null; then
  echo "Deployment left a staging directory behind."
  exit 1
fi

echo "Atomic deployment checks passed."
