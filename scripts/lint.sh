#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

app_code_dirs=()
for directory in app/*/server app/*/tests; do
  [[ -d "${directory}" ]] && app_code_dirs+=("${directory}")
done
mapfile -d '' -t php_files < <(find app/api tests/api "${app_code_dirs[@]}" -type f -name '*.php' -print0)
for file in "${php_files[@]}"; do
  php -l "${file}" >/dev/null
done
echo "PHP syntax: ${#php_files[@]} files passed"

mapfile -d '' -t shell_files < <(find scripts tests "${app_code_dirs[@]}" -type f -name '*.sh' -print0)
mapfile -d '' -t app_hooks < <(find app -mindepth 2 -maxdepth 2 -type f -name '*.sh' -print0)
shell_files+=("${app_hooks[@]}")
bash -n "${shell_files[@]}"
# These scripts include sourced helpers and dynamic test cases. ShellCheck cannot
# see those uses or follow the dynamic source path in the API test harness.
shellcheck -s bash -S warning -e SC2034,SC1090 "${shell_files[@]}"
echo "Shell syntax and ShellCheck: ${#shell_files[@]} files passed"
