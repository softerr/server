#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

QEMU_ENV_FILE="${QEMU_ENV_FILE:-${REPO_ROOT}/.qemu.env}"
if [[ -f "${QEMU_ENV_FILE}" ]]; then
  echo "Loading QEMU environment from: ${QEMU_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${QEMU_ENV_FILE}"
  set +a
fi

VM_NAME="${VM_NAME:-server-clone}"
VM_DIR="${VM_DIR:-${REPO_ROOT}/.qemu/${VM_NAME}}"
VM_USER="${VM_USER:-ubuntu}"
VM_CPUS="${VM_CPUS:-2}"
VM_RAM_MB="${VM_RAM_MB:-4096}"
VM_DISK_GB="${VM_DISK_GB:-30}"
SSH_PORT="${SSH_PORT:-2222}"
HTTP_PORT="${HTTP_PORT:-8080}"
UBUNTU_IMAGE_URL="${UBUNTU_IMAGE_URL:-https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img}"
WAIT_SSH_SECONDS="${WAIT_SSH_SECONDS:-240}"
RECREATE_VM_DISK="${RECREATE_VM_DISK:-0}"
SKIP_PROVISION="${SKIP_PROVISION:-0}"

BASE_IMAGE="${VM_DIR}/ubuntu-noble-cloudimg-amd64.img"
VM_DISK="${VM_DIR}/${VM_NAME}.qcow2"
SEED_IMAGE="${VM_DIR}/seed.img"
PID_FILE="${VM_DIR}/qemu.pid"
SERIAL_LOG="${VM_DIR}/serial.log"
SSH_KEY="${VM_DIR}/id_ed25519"
USER_DATA="${VM_DIR}/user-data"
META_DATA="${VM_DIR}/meta-data"
REMOTE_APP_DIR="/home/${VM_USER}/server"

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd}"
    exit 1
  fi
}

qemu_running() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

ensure_required_commands() {
  local missing=()
  local package_list=()
  local sudo_cmd=()

  if ! command -v curl >/dev/null 2>&1; then missing+=("curl"); fi
  if ! command -v qemu-img >/dev/null 2>&1; then missing+=("qemu-img"); fi
  if ! command -v qemu-system-x86_64 >/dev/null 2>&1; then missing+=("qemu-system-x86_64"); fi
  if ! command -v cloud-localds >/dev/null 2>&1; then missing+=("cloud-localds"); fi
  if ! command -v ssh-keygen >/dev/null 2>&1; then missing+=("ssh-keygen"); fi
  if ! command -v ssh >/dev/null 2>&1; then missing+=("ssh"); fi
  if ! command -v scp >/dev/null 2>&1; then missing+=("scp"); fi
  if ! command -v rsync >/dev/null 2>&1; then missing+=("rsync"); fi

  if [[ "${#missing[@]}" -eq 0 ]]; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    if [[ "${EUID}" -ne 0 ]]; then
      if command -v sudo >/dev/null 2>&1; then
        sudo_cmd=(sudo)
      else
        echo "Missing dependencies: ${missing[*]}"
        echo "sudo is not installed, rerun this script as root to auto-install packages."
        exit 1
      fi
    fi

    if [[ " ${missing[*]} " == *" curl "* ]]; then package_list+=("curl"); fi
    if [[ " ${missing[*]} " == *" qemu-img "* || " ${missing[*]} " == *" qemu-system-x86_64 "* ]]; then package_list+=("qemu-system-x86"); fi
    if [[ " ${missing[*]} " == *" cloud-localds "* ]]; then package_list+=("cloud-image-utils"); fi
    if [[ " ${missing[*]} " == *" ssh-keygen "* || " ${missing[*]} " == *" ssh "* || " ${missing[*]} " == *" scp "* ]]; then package_list+=("openssh-client"); fi
    if [[ " ${missing[*]} " == *" rsync "* ]]; then package_list+=("rsync"); fi

    if [[ "${#package_list[@]}" -gt 0 ]]; then
      local unique_packages=()
      local pkg
      for pkg in "${package_list[@]}"; do
        if [[ " ${unique_packages[*]} " != *" ${pkg} "* ]]; then
          unique_packages+=("${pkg}")
        fi
      done

      echo "Installing missing dependencies: ${unique_packages[*]}"
      export DEBIAN_FRONTEND=noninteractive
      "${sudo_cmd[@]}" apt-get update
      "${sudo_cmd[@]}" apt-get install -y "${unique_packages[@]}"
    fi
  else
    echo "Missing dependencies: ${missing[*]}"
    echo "Automatic install is supported on apt-get systems only."
    exit 1
  fi

  local still_missing=()
  if ! command -v curl >/dev/null 2>&1; then still_missing+=("curl"); fi
  if ! command -v qemu-img >/dev/null 2>&1; then still_missing+=("qemu-img"); fi
  if ! command -v qemu-system-x86_64 >/dev/null 2>&1; then still_missing+=("qemu-system-x86_64"); fi
  if ! command -v cloud-localds >/dev/null 2>&1; then still_missing+=("cloud-localds"); fi
  if ! command -v ssh-keygen >/dev/null 2>&1; then still_missing+=("ssh-keygen"); fi
  if ! command -v ssh >/dev/null 2>&1; then still_missing+=("ssh"); fi
  if ! command -v scp >/dev/null 2>&1; then still_missing+=("scp"); fi
  if ! command -v rsync >/dev/null 2>&1; then still_missing+=("rsync"); fi

  if [[ "${#still_missing[@]}" -gt 0 ]]; then
    echo "Dependencies still missing after install: ${still_missing[*]}"
    exit 1
  fi
}

prepare_vm_files() {
  mkdir -p "${VM_DIR}"

  if [[ ! -f "${BASE_IMAGE}" ]]; then
    echo "Downloading Ubuntu cloud image..."
    curl -L --fail --output "${BASE_IMAGE}" "${UBUNTU_IMAGE_URL}"
  fi

  if [[ "${RECREATE_VM_DISK}" == "1" ]]; then
    rm -f "${VM_DISK}"
  fi

  if [[ ! -f "${VM_DISK}" ]]; then
    echo "Creating VM overlay disk..."
    qemu-img create -f qcow2 -F qcow2 -b "${BASE_IMAGE}" "${VM_DISK}" "${VM_DISK_GB}G" >/dev/null
  fi

  if [[ ! -f "${SSH_KEY}" ]]; then
    echo "Generating SSH key for VM access..."
    ssh-keygen -t ed25519 -N "" -f "${SSH_KEY}" >/dev/null
  fi

  local pubkey
  pubkey="$(cat "${SSH_KEY}.pub")"

  cat > "${USER_DATA}" <<EOF
#cloud-config
users:
  - default
  - name: ${VM_USER}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${pubkey}
ssh_pwauth: false
disable_root: true
package_update: true
EOF

  cat > "${META_DATA}" <<EOF
instance-id: ${VM_NAME}
local-hostname: ${VM_NAME}
EOF

  cloud-localds "${SEED_IMAGE}" "${USER_DATA}" "${META_DATA}"
}

start_vm() {
  if qemu_running; then
    echo "VM is already running (pid $(cat "${PID_FILE}"))."
    return
  fi

  echo "Starting QEMU VM..."

  local accel cpu_model
  if [[ -r /dev/kvm && -w /dev/kvm ]]; then
    accel="kvm:tcg"
    cpu_model="host"
  else
    accel="tcg"
    cpu_model="max"
    echo "KVM is unavailable; using TCG emulation (slower)."
  fi

  qemu-system-x86_64 \
    -name "${VM_NAME}" \
    -machine "accel=${accel}" \
    -cpu "${cpu_model}" \
    -smp "${VM_CPUS}" \
    -m "${VM_RAM_MB}" \
    -drive "file=${VM_DISK},if=virtio" \
    -drive "file=${SEED_IMAGE},if=virtio,format=raw" \
    -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:${SSH_PORT}-:22,hostfwd=tcp:127.0.0.1:${HTTP_PORT}-:80" \
    -device virtio-net-pci,netdev=net0 \
    -display none \
    -daemonize \
    -pidfile "${PID_FILE}" \
    -serial "file:${SERIAL_LOG}"
}

wait_for_ssh() {
  echo "Waiting for SSH on localhost:${SSH_PORT}..."
  local waited=0
  until ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p "${SSH_PORT}" "${VM_USER}@127.0.0.1" "echo ssh-ready" >/dev/null 2>&1; do
    sleep 3
    waited=$((waited + 3))
    if (( waited >= WAIT_SSH_SECONDS )); then
      echo "Timed out waiting for VM SSH."
      echo "See serial log: ${SERIAL_LOG}"
      exit 1
    fi
  done
  echo "SSH is ready."
}

wait_for_cloud_init() {
  local ssh_cmd
  ssh_cmd=(ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${SSH_PORT}" "${VM_USER}@127.0.0.1")

  echo "Waiting for cloud-init to finish in VM..."
  "${ssh_cmd[@]}" "bash -s" <<'EOF'
set -euo pipefail
if command -v cloud-init >/dev/null 2>&1; then
  sudo cloud-init status --wait
fi
EOF
  echo "cloud-init completed."
}

ensure_quiz_dist() {
  if [[ ! -d "${REPO_ROOT}/app/quiz/dist" ]]; then
    echo "Quiz dist artifacts not found locally. Building app/quiz..."
    if ! command -v npm >/dev/null 2>&1; then
      echo "npm is required to build app/quiz locally before VM provisioning."
      echo "Install npm or build app/quiz manually, then rerun qemu.sh."
      exit 1
    fi
    (
      cd "${REPO_ROOT}/app/quiz"
      if [[ -f package-lock.json ]]; then
        npm ci
      else
        npm install
      fi
      npm run build
    )
  fi
}

sync_repo_to_vm() {
  echo "Syncing project into VM..."
  rsync -az --delete \
    --exclude=".git" \
    --exclude=".qemu" \
    --exclude="app/quiz/node_modules" \
    -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${SSH_PORT}" \
    "${REPO_ROOT}/" "${VM_USER}@127.0.0.1:${REMOTE_APP_DIR}/"
}

run_remote_script() {
  local script_rel="$1"
  local ssh_cmd
  ssh_cmd=(ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${SSH_PORT}" "${VM_USER}@127.0.0.1")

  local env_names=(
    SCRIPT_REL
    PROVISION_COMPONENTS
    POSTGRES_AUTH_API_PASSWORD
    API_DB_PASSWORD
    API_MAIL_FROM
    API_APP_BASE_URL
    API_SMTP_HOST
    API_SMTP_PORT
    API_SMTP_ENCRYPTION
    API_SMTP_USERNAME
    API_SMTP_PASSWORD
    API_TEST_BASE_URL
    API_TEST_DB_NAME
    API_TEST_DB_SUPERUSER
    API_TEST_REQUIRE_DB
    API_TEST_REQUIRE_EMAIL
  )
  local assignments=()
  local env_name env_value env_b64
  for env_name in "${env_names[@]}"; do
    if [[ "${env_name}" == "SCRIPT_REL" ]]; then
      env_value="${script_rel}"
    else
      env_value="${!env_name:-}"
    fi
    env_b64="$(printf '%s' "${env_value}" | base64 -w 0)"
    assignments+=("${env_name}_B64='${env_b64}'")
  done

  local all_vars_csv
  all_vars_csv="$(IFS=,; printf '%s' "${env_names[*]}")"

  "${ssh_cmd[@]}" "${assignments[*]} ALL_VARS_CSV='${all_vars_csv}' bash -s" <<'EOF'
set -euo pipefail
cd /home/ubuntu/server

for var_name in ${ALL_VARS_CSV//,/ }; do
  b64_var="${var_name}_B64"
  decoded_value="$(printf '%s' "${!b64_var}" | base64 -d)"
  printf -v "${var_name}" '%s' "${decoded_value}"
done

if [[ ! -f "${SCRIPT_REL}" ]]; then
  echo "Script not found in VM repo: ${SCRIPT_REL}"
  exit 1
fi

chmod +x "${SCRIPT_REL}"

case "${SCRIPT_REL}" in
  scripts/provision.sh)
    export PROVISION_COMPONENTS POSTGRES_AUTH_API_PASSWORD API_DB_PASSWORD API_MAIL_FROM API_APP_BASE_URL API_SMTP_HOST API_SMTP_PORT API_SMTP_ENCRYPTION API_SMTP_USERNAME API_SMTP_PASSWORD
    sudo --preserve-env=PROVISION_COMPONENTS,POSTGRES_AUTH_API_PASSWORD,API_DB_PASSWORD,API_MAIL_FROM,API_APP_BASE_URL,API_SMTP_HOST,API_SMTP_PORT,API_SMTP_ENCRYPTION,API_SMTP_USERNAME,API_SMTP_PASSWORD \
      bash "${SCRIPT_REL}"
    ;;
  scripts/test_api.sh)
    export API_TEST_BASE_URL API_TEST_DB_NAME API_TEST_DB_SUPERUSER API_TEST_REQUIRE_DB API_TEST_REQUIRE_EMAIL
    sudo --preserve-env=API_TEST_BASE_URL,API_TEST_DB_NAME,API_TEST_DB_SUPERUSER,API_TEST_REQUIRE_DB,API_TEST_REQUIRE_EMAIL \
      bash "${SCRIPT_REL}"
    ;;
  scripts/setup_postgresql.sh)
    if [[ -z "${POSTGRES_AUTH_API_PASSWORD}" ]]; then
      echo "POSTGRES_AUTH_API_PASSWORD is required to run ${SCRIPT_REL}"
      exit 1
    fi
    export POSTGRES_AUTH_API_PASSWORD
    sudo --preserve-env=POSTGRES_AUTH_API_PASSWORD bash "${SCRIPT_REL}"
    ;;
  scripts/setup_nginx.sh)
    if [[ -z "${API_DB_PASSWORD}" ]]; then
      echo "API_DB_PASSWORD is required to run ${SCRIPT_REL}"
      exit 1
    fi
    export API_DB_PASSWORD API_MAIL_FROM API_APP_BASE_URL API_SMTP_HOST API_SMTP_PORT API_SMTP_ENCRYPTION API_SMTP_USERNAME API_SMTP_PASSWORD
    sudo --preserve-env=API_DB_PASSWORD,API_MAIL_FROM,API_APP_BASE_URL,API_SMTP_HOST,API_SMTP_PORT,API_SMTP_ENCRYPTION,API_SMTP_USERNAME,API_SMTP_PASSWORD \
      bash "${SCRIPT_REL}"
    ;;
  scripts/deploy_quiz.sh)
    mkdir -p /tmp/workflow-artifacts
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete /home/ubuntu/server/app/ /tmp/workflow-artifacts/app/
    else
      rm -rf /tmp/workflow-artifacts/app
      mkdir -p /tmp/workflow-artifacts/app
      cp -a /home/ubuntu/server/app/. /tmp/workflow-artifacts/app/
    fi
    sudo bash "${SCRIPT_REL}"
    ;;
  *)
    sudo bash "${SCRIPT_REL}"
    ;;
esac
EOF
}

provision_vm() {
  if [[ "${SKIP_PROVISION}" == "1" ]]; then
    echo "Skipping provisioning (SKIP_PROVISION=1)."
    return
  fi

  if [[ -z "${POSTGRES_AUTH_API_PASSWORD:-}" ]]; then
    echo "POSTGRES_AUTH_API_PASSWORD is required for provisioning."
    exit 1
  fi
  if [[ -z "${API_DB_PASSWORD:-}" ]]; then
    echo "API_DB_PASSWORD is required for provisioning."
    exit 1
  fi
  if [[ -z "${API_SMTP_HOST:-}" ]]; then
    echo "Warning: API_SMTP_HOST is not set."
    echo "Signup verification email in VM will fail unless VM has a working local MTA for PHP mail()."
  fi

  wait_for_cloud_init
  ensure_quiz_dist
  sync_repo_to_vm

  echo "Running server setup scripts inside VM..."
  run_remote_script "scripts/provision.sh"
}

apply_script_vm() {
  local script_rel="${1:-scripts/setup_nginx.sh}"

  if ! qemu_running; then
    echo "VM is not running. Start it first: bash scripts/qemu.sh start"
    exit 1
  fi

  if [[ ! -f "${REPO_ROOT}/${script_rel}" ]]; then
    echo "Local script not found: ${script_rel}"
    exit 1
  fi

  wait_for_ssh
  wait_for_cloud_init

  if [[ "${script_rel}" == "scripts/deploy_quiz.sh" ]]; then
    ensure_quiz_dist
  fi

  sync_repo_to_vm
  run_remote_script "${script_rel}"
  echo "Applied ${script_rel} in VM."
}

test_api_vm() {
  if ! qemu_running; then
    echo "VM is not running. Start it first: bash scripts/qemu.sh start"
    exit 1
  fi

  wait_for_ssh
  wait_for_cloud_init
  sync_repo_to_vm

  export API_TEST_BASE_URL="${API_TEST_BASE_URL:-http://127.0.0.1}"
  export API_TEST_DB_NAME="${API_TEST_DB_NAME:-auth}"
  export API_TEST_DB_SUPERUSER="${API_TEST_DB_SUPERUSER:-postgres}"
  export API_TEST_REQUIRE_DB="${API_TEST_REQUIRE_DB:-1}"
  export API_TEST_REQUIRE_EMAIL="${API_TEST_REQUIRE_EMAIL:-1}"

  run_remote_script "scripts/test_api.sh"
}

print_usage() {
  cat <<'EOF'
Usage:
  bash scripts/qemu.sh [start|stop|status|ssh|apply|test-api]

Commands:
  start   Create/launch VM and provision it with server scripts (default)
  stop    Stop running VM
  status  Show VM status
  ssh     SSH into VM
  apply   Sync repo and run one script in VM (default: scripts/setup_nginx.sh)
  test-api Sync repo and run scripts/test_api.sh in VM

Environment variables:
  POSTGRES_AUTH_API_PASSWORD   Required for provisioning
  API_DB_PASSWORD              Required for provisioning
  API_MAIL_FROM                Optional sender address
  API_APP_BASE_URL             Optional public base URL for verification links
  API_SMTP_HOST                Optional SMTP host (recommended for verification emails)
  API_SMTP_PORT                Optional SMTP port (default 587 in API)
  API_SMTP_ENCRYPTION          Optional tls|ssl|none (default tls in API)
  API_SMTP_USERNAME            Optional SMTP username
  API_SMTP_PASSWORD            Optional SMTP password
  API_TEST_BASE_URL            Default: http://127.0.0.1
  API_TEST_DB_NAME             Default: auth
  API_TEST_DB_SUPERUSER        Default: postgres
  API_TEST_REQUIRE_DB          Default: 1
  API_TEST_REQUIRE_EMAIL       Default: 1 (require signup email delivery checks)
  VM_NAME                      Default: server-clone
  VM_DIR                       Default: ./.qemu/<VM_NAME>
  SSH_PORT                     Default: 2222
  HTTP_PORT                    Default: 8080
  VM_CPUS                      Default: 2
  VM_RAM_MB                    Default: 4096
  VM_DISK_GB                   Default: 30
  RECREATE_VM_DISK             1 to recreate overlay disk
  SKIP_PROVISION               1 to only boot VM

Examples:
  bash scripts/qemu.sh apply scripts/setup_postgresql.sh
  bash scripts/qemu.sh apply scripts/setup_nginx.sh
  bash scripts/qemu.sh test-api
EOF
}

stop_vm() {
  if ! qemu_running; then
    echo "VM is not running."
    return
  fi
  local pid
  pid="$(cat "${PID_FILE}")"
  kill "${pid}"
  rm -f "${PID_FILE}"
  echo "VM stopped."
}

status_vm() {
  if qemu_running; then
    echo "VM running (pid $(cat "${PID_FILE}"))."
    echo "SSH: ssh -i ${SSH_KEY} -p ${SSH_PORT} ${VM_USER}@127.0.0.1"
    echo "HTTP: http://127.0.0.1:${HTTP_PORT}"
  else
    echo "VM stopped."
  fi
}

ssh_vm() {
  ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${SSH_PORT}" "${VM_USER}@127.0.0.1"
}

main() {
  local command="${1:-start}"
  case "${command}" in
    start)
      ensure_required_commands
      prepare_vm_files
      start_vm
      wait_for_ssh
      provision_vm
      echo "VM is ready."
      echo "SSH: ssh -i ${SSH_KEY} -p ${SSH_PORT} ${VM_USER}@127.0.0.1"
      echo "HTTP: http://127.0.0.1:${HTTP_PORT}"
      ;;
    stop)
      stop_vm
      ;;
    status)
      status_vm
      ;;
    ssh)
      ssh_vm
      ;;
    apply)
      apply_script_vm "${2:-scripts/setup_nginx.sh}"
      ;;
    test-api)
      test_api_vm
      ;;
    -h|--help|help)
      print_usage
      ;;
    *)
      echo "Unknown command: ${command}"
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
