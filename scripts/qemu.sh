#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/app_selection.sh"

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
API_APP_BASE_URL="${API_APP_BASE_URL:-http://127.0.0.1:${HTTP_PORT}}"
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
SSH_TARGET="${VM_USER}@127.0.0.1"
SSH_OPTIONS=(-i "${SSH_KEY}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${SSH_PORT}")

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
  local requirements=(
    'curl curl'
    'qemu-img qemu-system-x86'
    'qemu-system-x86_64 qemu-system-x86'
    'cloud-localds cloud-image-utils'
    'ssh-keygen openssh-client'
    'ssh openssh-client'
    'rsync rsync'
  )
  local missing=()
  local package_list=()
  local sudo_cmd=()
  local requirement command_name package_name
  local -A seen_packages=()

  for requirement in "${requirements[@]}"; do
    command_name="${requirement%% *}"
    package_name="${requirement#* }"
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      missing+=("${command_name}")
      if [[ -z "${seen_packages[$package_name]:-}" ]]; then
        package_list+=("${package_name}")
        seen_packages[$package_name]=1
      fi
    fi
  done

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

    echo "Installing missing dependencies: ${package_list[*]}"
    export DEBIAN_FRONTEND=noninteractive
    "${sudo_cmd[@]}" apt-get update
    "${sudo_cmd[@]}" apt-get install -y "${package_list[@]}"
  else
    echo "Missing dependencies: ${missing[*]}"
    echo "Automatic install is supported on apt-get systems only."
    exit 1
  fi

  local still_missing=()
  for command_name in "${missing[@]}"; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      still_missing+=("${command_name}")
    fi
  done

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
  until ssh "${SSH_OPTIONS[@]}" -o ConnectTimeout=5 "${SSH_TARGET}" "echo ssh-ready" >/dev/null 2>&1; do
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
  echo "Waiting for cloud-init to finish in VM..."
  ssh "${SSH_OPTIONS[@]}" "${SSH_TARGET}" "bash -s" <<'EOF'
set -euo pipefail
if command -v cloud-init >/dev/null 2>&1; then
  sudo cloud-init status --wait
fi
EOF
  echo "cloud-init completed."
}

bootstrap_vm() {
  local bootstrap_output line workflow_key_b64="" known_hosts="" db_password=""
  local workflow_user="" workflow_port="" workflow_host=""
  echo "Running server bootstrap in VM..."
  if ! bootstrap_output="$(ssh "${SSH_OPTIONS[@]}" "${SSH_TARGET}" \
    "sudo bash -s -- 127.0.0.1 qemu@example.test ${SSH_PORT}" \
    < "${REPO_ROOT}/scripts/bootstrap_server.sh")"; then
    echo "Server bootstrap failed in VM." >&2
    return 1
  fi

  while IFS= read -r line; do
    case "${line}" in
      SERVER_HOST=*) workflow_host="${line#*=}" ;;
      SERVER_USER=*) workflow_user="${line#*=}" ;;
      SERVER_PORT=*) workflow_port="${line#*=}" ;;
      SERVER_SSH_KEY_B64=*) workflow_key_b64="${line#*=}" ;;
      SERVER_SSH_KNOWN_HOSTS=*) known_hosts="${line#*=}" ;;
      API_DB_PASSWORD=*) db_password="${line#*=}" ;;
    esac
  done <<< "${bootstrap_output}"

  if [[ "${workflow_host}" != 127.0.0.1 || "${workflow_user}" != github-workflow \
    || "${workflow_port}" != "${SSH_PORT}" || ! "${db_password}" =~ ^[a-f0-9]{64}$ \
    || -z "${workflow_key_b64}" || -z "${known_hosts}" ]]; then
    echo "Server bootstrap did not return the expected QEMU connection values." >&2
    return 1
  fi

  local expected_host=127.0.0.1
  if [[ "${SSH_PORT}" != 22 ]]; then
    expected_host="[127.0.0.1]:${SSH_PORT}"
  fi
  if [[ "${known_hosts}" != "${expected_host} ssh-ed25519 "* ]]; then
    echo "Server bootstrap returned an unexpected SSH host key entry." >&2
    return 1
  fi

  local workflow_key="${VM_DIR}/github-workflow_ed25519"
  local workflow_known_hosts="${VM_DIR}/github-workflow_known_hosts"
  install -m 600 /dev/null "${workflow_key}"
  if ! printf '%s' "${workflow_key_b64}" | base64 -d > "${workflow_key}"; then
    echo "Server bootstrap returned an invalid workflow SSH key." >&2
    return 1
  fi
  printf '%s\n' "${known_hosts}" > "${workflow_known_hosts}"
  chmod 600 "${workflow_known_hosts}"

  local workflow_ssh=(ssh -i "${workflow_key}" -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${workflow_known_hosts}" \
    -p "${SSH_PORT}" "${workflow_user}@127.0.0.1")
  if ! "${workflow_ssh[@]}" 'test "$(id -un)" = github-workflow'; then
    echo "Server bootstrap workflow user cannot sign in with its generated SSH key." >&2
    return 1
  fi
  if ! "${workflow_ssh[@]}" 'set -eu
    check_dir=/tmp/workflow-artifacts/runs/qemu-bootstrap-1/scripts
    mkdir -p "$check_dir"
    printf "#!/usr/bin/env bash\nexit 0\n" > "$check_dir/check.sh"
    sudo -n /bin/bash "$check_dir/check.sh"
    rm -f "$check_dir/check.sh"
    rmdir "$check_dir"'; then
    echo "Server bootstrap workflow user cannot run uploaded scripts through sudo." >&2
    return 1
  fi

  API_DB_PASSWORD="${db_password}"
  echo "Server bootstrap checks passed: workflow SSH, pinned host key, and deployment sudo access."
}

provision_includes_quiz() {
  local components="${PROVISION_COMPONENTS:-all}"
  components="${components//,/ }"
  local component
  for component in ${components}; do
    case "${component}" in
      all|quiz) return 0 ;;
      apps)
        select_apps "${APP_LIST:-all}"
        app_selected quiz && return 0
        ;;
    esac
  done
  return 1
}

build_quiz_dist() {
  echo "Building app/quiz from current source..."
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to build app/quiz before VM deployment."
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
}

check_quiz_routes() {
  local route status
  for route in /quiz /quiz/; do
    if ! status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:${HTTP_PORT}${route}")"; then
      echo "Quiz route check failed: ${route} is unreachable."
      return 1
    fi
    if [[ "${status}" != "200" ]]; then
      echo "Quiz route check failed: ${route} returned HTTP ${status}, expected 200."
      return 1
    fi
  done
  echo "Quiz routes /quiz and /quiz/ returned HTTP 200."
}

sync_repo_to_vm() {
  echo "Syncing project into VM..."
  # rsync accepts its remote shell as one command string rather than an argv array.
  local rsync_ssh="ssh ${SSH_OPTIONS[*]}"
  # Hide local env files and delete copies left by earlier syncs.
  local -a secret_filters=(--filter='H /.qemu.env' --filter='R /.qemu.env')
  if [[ -f "${QEMU_ENV_FILE}" ]]; then
    local env_file repo_dir relative_env_file
    env_file="$(realpath -- "${QEMU_ENV_FILE}")"
    repo_dir="$(realpath -- "${REPO_ROOT}")"
    if [[ "${env_file}" == "${repo_dir}/"* ]]; then
      relative_env_file="${env_file#"${repo_dir}/"}"
      secret_filters+=(--filter="H /${relative_env_file}" --filter="R /${relative_env_file}")
    fi
  fi

  rsync -az --delete \
    "${secret_filters[@]}" \
    --exclude=".git" \
    --exclude=".qemu" \
    --exclude="app/quiz/node_modules" \
    -e "${rsync_ssh}" \
    "${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_APP_DIR}/"
}

run_remote_script() {
  local script_rel="$1"

  local env_names=(
    SCRIPT_REL
    REMOTE_APP_DIR
    PROVISION_COMPONENTS
    APP_LIST
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
    API_TEST_MAILPIT_URL
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

  ssh "${SSH_OPTIONS[@]}" "${SSH_TARGET}" "${assignments[*]} ALL_VARS_CSV='${all_vars_csv}' bash -s" <<'EOF'
set -euo pipefail

for var_name in ${ALL_VARS_CSV//,/ }; do
  b64_var="${var_name}_B64"
  decoded_value="$(printf '%s' "${!b64_var}" | base64 -d)"
  printf -v "${var_name}" '%s' "${decoded_value}"
done

cd -- "${REMOTE_APP_DIR}"

if [[ ! -f "${SCRIPT_REL}" ]]; then
  echo "Script not found in VM repo: ${SCRIPT_REL}"
  exit 1
fi

chmod +x "${SCRIPT_REL}"

case "${SCRIPT_REL}" in
  scripts/provision.sh)
    export PROVISION_COMPONENTS APP_LIST API_DB_PASSWORD API_MAIL_FROM API_APP_BASE_URL API_SMTP_HOST API_SMTP_PORT API_SMTP_ENCRYPTION API_SMTP_USERNAME API_SMTP_PASSWORD
    sudo --preserve-env=PROVISION_COMPONENTS,APP_LIST,API_DB_PASSWORD,API_MAIL_FROM,API_APP_BASE_URL,API_SMTP_HOST,API_SMTP_PORT,API_SMTP_ENCRYPTION,API_SMTP_USERNAME,API_SMTP_PASSWORD \
      bash "${SCRIPT_REL}"
    ;;
  scripts/test_api.sh)
    export API_TEST_BASE_URL API_TEST_DB_NAME API_TEST_DB_SUPERUSER API_TEST_REQUIRE_DB API_TEST_REQUIRE_EMAIL API_TEST_MAILPIT_URL
    sudo --preserve-env=API_TEST_BASE_URL,API_TEST_DB_NAME,API_TEST_DB_SUPERUSER,API_TEST_REQUIRE_DB,API_TEST_REQUIRE_EMAIL,API_TEST_MAILPIT_URL \
      bash "${SCRIPT_REL}"
    ;;
  *)
    echo "Unsupported VM script: ${SCRIPT_REL}" >&2
    exit 1
    ;;
esac
EOF
}

provision_vm() {
  if [[ "${SKIP_PROVISION}" == "1" ]]; then
    echo "Skipping provisioning (SKIP_PROVISION=1)."
    return
  fi

  wait_for_cloud_init
  bootstrap_vm
  if [[ -z "${API_SMTP_HOST:-}" ]]; then
    echo "Warning: API_SMTP_HOST is not set."
    echo "Signup verification email in VM will fail unless VM has a working local MTA for PHP mail()."
  fi

  if provision_includes_quiz; then
    build_quiz_dist
  fi
  sync_repo_to_vm

  echo "Running server setup scripts inside VM..."
  run_remote_script "scripts/provision.sh"
  if provision_includes_quiz; then
    check_quiz_routes
  fi
}

apply_component_vm() {
  local component="$1"
  case "${component}" in
    all|postgresql|php-fpm|email-worker|nginx|api|quiz|apps) ;;
    *)
      echo "Unknown provisioning component: ${component}" >&2
      echo "Expected one of: all, postgresql, php-fpm, email-worker, nginx, api, quiz, apps" >&2
      return 1
      ;;
  esac
  if [[ "${component}" == apps ]]; then
    select_apps "${APP_LIST:-all}"
  fi

  local PROVISION_COMPONENTS="${component}"

  if ! qemu_running; then
    echo "VM is not running. Start it first: bash scripts/qemu.sh start"
    exit 1
  fi

  wait_for_ssh
  wait_for_cloud_init
  bootstrap_vm

  if provision_includes_quiz; then
    build_quiz_dist
  fi

  sync_repo_to_vm
  run_remote_script "scripts/provision.sh"
  if provision_includes_quiz || [[ "${component}" == nginx ]]; then
    check_quiz_routes
  fi
  echo "Applied ${component} in VM."
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
  export API_TEST_MAILPIT_URL="${API_TEST_MAILPIT_URL:-}"

  run_remote_script "scripts/test_api.sh"
}

print_usage() {
  cat <<'EOF'
Usage:
  bash scripts/qemu.sh [start|stop|status|ssh|test-api]
  bash scripts/qemu.sh apply <component>

Commands:
  start   Create/launch VM and provision it with server scripts (default)
  stop    Stop running VM
  status  Show VM status
  ssh     SSH into VM
  apply <component> Sync repo and provision one component in VM
  test-api Sync repo and run scripts/test_api.sh in VM

Environment variables:
  API_DB_PASSWORD              Generated by bootstrap for start and apply
  API_MAIL_FROM                Optional sender address
  API_APP_BASE_URL             Verification-link origin (default: http://127.0.0.1:<HTTP_PORT>)
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
  API_TEST_MAILPIT_URL         Optional Mailpit API URL for resend delivery test
  PROVISION_COMPONENTS         Components to run during start (default: all)
  APP_LIST                     all|api|quiz when applying apps (default: all)
  VM_NAME                      Default: server-clone
  VM_USER                      Default: ubuntu (repo syncs to /home/<VM_USER>/server)
  VM_DIR                       Default: ./.qemu/<VM_NAME>
  SSH_PORT                     Default: 2222
  HTTP_PORT                    Default: 8080
  VM_CPUS                      Default: 2
  VM_RAM_MB                    Default: 4096
  VM_DISK_GB                   Default: 30
  RECREATE_VM_DISK             1 to recreate overlay disk
  SKIP_PROVISION               1 to only boot VM

Examples:
  bash scripts/qemu.sh apply postgresql
  bash scripts/qemu.sh apply nginx
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
    print_vm_access
  else
    echo "VM stopped."
  fi
}

print_vm_access() {
  echo "SSH: ssh -i ${SSH_KEY} -p ${SSH_PORT} ${SSH_TARGET}"
  echo "HTTP: http://127.0.0.1:${HTTP_PORT}"
}

ssh_vm() {
  ssh "${SSH_OPTIONS[@]}" "${SSH_TARGET}"
}

main() {
  local command="${1:-start}"
  case "${command}" in
    start)
      if qemu_running && [[ "${RECREATE_VM_DISK}" == "1" ]]; then
        echo "Cannot recreate the VM disk while the VM is running. Stop it first: bash scripts/qemu.sh stop" >&2
        exit 1
      fi
      ensure_required_commands
      if qemu_running; then
        echo "VM is already running (pid $(cat "${PID_FILE}"))."
      else
        prepare_vm_files
        start_vm
      fi
      wait_for_ssh
      provision_vm
      echo "VM is ready."
      print_vm_access
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
      if [[ $# -ne 2 ]]; then
        echo "Usage: bash scripts/qemu.sh apply <component>" >&2
        exit 1
      fi
      apply_component_vm "$2"
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
