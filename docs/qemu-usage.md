# QEMU Usage

This repo includes `scripts/qemu.sh` to run a local VM that mirrors server setup flow.

Provisioning in QEMU uses the same shared entrypoint as workflows:
- `scripts/provision.sh`

## 1. Required environment variables

Before first provisioning (`start`), set:

```bash
export POSTGRES_AUTH_API_PASSWORD='change-me'
export API_DB_PASSWORD='change-me'
```

Optional (recommended for signup email verification):

```bash
export API_MAIL_FROM='no-reply@example.com'
export API_APP_BASE_URL='http://127.0.0.1:8080'
export API_SMTP_HOST='smtp.example.com'
export API_SMTP_PORT='587'
export API_SMTP_ENCRYPTION='tls'
export API_SMTP_USERNAME='smtp-user'
export API_SMTP_PASSWORD='smtp-pass'
```

## 2. Start VM and provision everything

```bash
bash scripts/qemu.sh start
```

Default access:
- HTTP: `http://127.0.0.1:8080`
- SSH: `bash scripts/qemu.sh ssh`

`start` does:
- boots VM
- syncs repo into VM (`/home/ubuntu/server`)
- runs `scripts/provision.sh` with default `PROVISION_COMPONENTS=all`

## 3. Apply changed script quickly (no full rebuild)

After editing a script, run:

```bash
bash scripts/qemu.sh apply scripts/setup_nginx.sh
```

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

## 4. VM lifecycle commands

```bash
bash scripts/qemu.sh status
bash scripts/qemu.sh ssh
bash scripts/qemu.sh stop
```

## 5. Recreate VM from clean disk

```bash
RECREATE_VM_DISK=1 bash scripts/qemu.sh start
```

Useful optional overrides:
- `SSH_PORT` (default `2222`)
- `HTTP_PORT` (default `8080`)
- `VM_RAM_MB` (default `4096`)
- `VM_CPUS` (default `2`)
- `VM_DISK_GB` (default `30`)

## 6. Skip provisioning (boot only)

```bash
SKIP_PROVISION=1 bash scripts/qemu.sh start
```

Then run provisioning manually:

```bash
export PROVISION_COMPONENTS='all'
bash scripts/qemu.sh apply scripts/provision.sh
```
