#!/usr/bin/env bash

select_apps() {
  SELECTED_APPS=()
  case "${1:-all}" in
    all) SELECTED_APPS=(api home quiz) ;;
    api) SELECTED_APPS=(api) ;;
    home) SELECTED_APPS=(home) ;;
    quiz) SELECTED_APPS=(quiz) ;;
    *) echo "Expected APP_LIST to be all, api, home, or quiz." >&2; return 1 ;;
  esac
}

app_selected() {
  local app
  for app in "${SELECTED_APPS[@]}"; do
    [[ "${app}" == "$1" ]] && return 0
  done
  return 1
}
