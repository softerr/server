#!/usr/bin/env bash

install_app_services() {
  local root="${1:?repository root is required}" app file name
  local -a timers=() files=()
  local -A seen=()
  local installed=false
  for app in "${WEB_APPS[@]}"; do
    for file in "${root}/${APP_SOURCES[$app]}/server/systemd/"*.service \
      "${root}/${APP_SOURCES[$app]}/server/systemd/"*.timer; do
      [[ -f "${file}" ]] || continue
      name="${file##*/}"
      [[ "${name}" =~ ^softerr-[a-z0-9-]+\.(service|timer)$ ]] || {
        echo "Invalid app systemd unit: ${file}" >&2
        return 1
      }
      [[ -z "${seen[$name]:-}" ]] || {
        echo "Duplicate app systemd unit: ${name}" >&2
        return 1
      }
      seen["${name}"]=1
      files+=("${file}")
      [[ "${name}" == *.timer ]] && timers+=("${name}")
    done
  done
  for file in "${files[@]}"; do
    install -m 644 "${file}" "/etc/systemd/system/${file##*/}"
    installed=true
  done
  if [[ "${installed}" == true ]]; then
    systemctl daemon-reload
    for name in "${timers[@]}"; do systemctl enable --now "${name}"; done
  fi
}
