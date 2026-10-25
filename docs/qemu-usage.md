# QEMU Usage

This repo includes `scripts/qemu.sh` to run a local VM that mirrors server setup flow.

Provisioning in QEMU uses the same shared entrypoint as workflows:
- `scripts/provision.sh`

## 1. Persist variables in a file (recommended)

Create a local env file once:

```bash
cp .qemu.env.example .qemu.env
```

Then edit `.qemu.env` with your values (passwords, local Mailpit, ports, test flags).

`scripts/qemu.sh` auto-loads this file on each run.
The VM sync excludes this file (including a custom `QEMU_ENV_FILE` inside the repository) and removes copies left by earlier syncs.

Optional override:

```bash
QEMU_ENV_FILE=/path/to/my-qemu.env bash scripts/qemu.sh start
```

## 2. Required environment variables

Before first provisioning (`start`), set:

```bash
export API_DB_PASSWORD='change-me'
```

Optional URL override and local email settings:

```bash
export API_MAIL_FROM='no-reply@example.test'
export API_APP_BASE_URL='http://127.0.0.1:8080'
export API_SMTP_HOST='10.0.2.2'
export API_SMTP_PORT='1025'
export API_SMTP_ENCRYPTION='none'
export API_TEST_MAILPIT_URL='http://10.0.2.2:8025'
```

QEMU defaults `API_APP_BASE_URL` to `http://127.0.0.1:<HTTP_PORT>` when unset. Set it explicitly if you access the VM through another origin.
For email tests, run Mailpit on the host with SMTP port 1025, HTTP port 8025, and Chaos enabled (`MP_ENABLE_CHAOS=true`) before starting the VM. The VM reaches host services at `10.0.2.2`.

## 3. Start VM and provision everything

```bash
bash scripts/qemu.sh start
```

Default access:
- HTTP: `http://127.0.0.1:8080`
- SSH: `bash scripts/qemu.sh ssh`

`start` does:
- boots VM
- rebuilds the quiz from current source when provisioning includes `quiz`, `apps`, or `all`
- syncs repo into VM (`/home/ubuntu/server`)
- runs `scripts/provision.sh` with default `PROVISION_COMPONENTS=all`
- checks that `/quiz` and `/quiz/` both return HTTP 200 after quiz deployment

## 4. Apply changed script quickly (no full rebuild)

After editing a script, run:

```bash
bash scripts/qemu.sh apply scripts/setup_nginx.sh
```

Applying `scripts/deploy_quiz.sh` or provisioning `quiz`, `apps`, or `all` rebuilds the quiz before syncing. Quiz and Nginx applies also check both quiz URLs afterward.

Other examples:

```bash
bash scripts/qemu.sh apply scripts/setup_postgresql.sh
bash scripts/qemu.sh apply scripts/deploy_api.sh
bash scripts/qemu.sh apply scripts/provision.sh
```

When applying `scripts/provision.sh`, you can limit scope:

```bash
export PROVISION_COMPONENTS='nginx'
bash scripts/qemu.sh apply scripts/provision.sh
```

Supported components:
- `all`
- `postgresql`
- `nginx`
- `api`
- `quiz`
- `apps` (runs all `deploy_*.sh`)

## 5. Run API tests in QEMU (one command)

From your PC:

```bash
bash scripts/qemu.sh test-api
```

Optional overrides:

```bash
API_TEST_BASE_URL='http://127.0.0.1' \
API_TEST_DB_NAME='auth' \
API_TEST_DB_SUPERUSER='postgres' \
API_TEST_REQUIRE_DB='1' \
API_TEST_REQUIRE_EMAIL='1' \
bash scripts/qemu.sh test-api
```

## 6. VM lifecycle commands

```bash
bash scripts/qemu.sh status
bash scripts/qemu.sh ssh
bash scripts/qemu.sh stop
```

## 7. Recreate VM from clean disk

```bash
RECREATE_VM_DISK=1 bash scripts/qemu.sh start
```

Useful optional overrides:
- `SSH_PORT` (default `2222`)
- `HTTP_PORT` (default `8080`)
- `VM_RAM_MB` (default `4096`)
- `VM_CPUS` (default `2`)
- `VM_DISK_GB` (default `30`)

## 8. Skip provisioning (boot only)

```bash
SKIP_PROVISION=1 bash scripts/qemu.sh start
```

Then run provisioning manually:

```bash
export PROVISION_COMPONENTS='all'
bash scripts/qemu.sh apply scripts/provision.sh
```
