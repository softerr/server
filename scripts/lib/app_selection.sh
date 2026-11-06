#!/usr/bin/env bash

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/app_registry.sh"

select_apps() {
  load_app_registry "${REPO_ROOT:?repository root is required}"
  SELECTED_APPS=()
  case "${1:-all}" in
    all) SELECTED_APPS=(api "${WEB_APPS[@]}") ;;
    api) SELECTED_APPS=(api) ;;
    *)
      if web_app_exists "$1"; then SELECTED_APPS=("$1")
      else echo "Expected APP_LIST to be all, api, or one of: ${WEB_APPS[*]}." >&2; return 1
      fi ;;
  esac
}

app_selected() {
  local app
  for app in "${SELECTED_APPS[@]}"; do
    [[ "${app}" == "$1" ]] && return 0
  done
  return 1
}
