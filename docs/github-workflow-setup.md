# GitHub Workflow Server Setup

This project includes:
- Workflow: `.github/workflows/setup-nginx.yml`
- Workflow: `.github/workflows/setup-postgresql.yml`
- Workflow: `.github/workflows/deploy-apps.yml`
- Workflow: `.github/workflows/test-api-qemu.yml`
- Shared provisioning entrypoint: `scripts/provision.sh`
- Server bootstrap script: `scripts/create_github_workflow_user.sh`
- Deploy scripts directory: `scripts/*.sh`

## 1. Prepare the server user

Run on your server (as root or with sudo):

```bash
sudo bash scripts/create_github_workflow_user.sh
```

What this configures:
- Creates SSH user `github-workflow` (if missing)
- Adds an SSH public key to `/home/github-workflow/.ssh/authorized_keys`
- Creates sudoers rule so this user can run only `sudo bash /tmp/workflow-artifacts/scripts/<script>.sh`

## 2. Configure SSH key for GitHub Actions

You must set `SERVER_SSH_KEY` to a private key matching the public key installed by step 1.

If script output says it generated a keypair, print private key from server:

```bash
sudo cat /root/.ssh/github-workflow_github_actions_ed25519
```

Copy that full output into GitHub secret `SERVER_SSH_KEY`.
Recommended alternative (less formatting risk): set `SERVER_SSH_KEY_B64` with base64-encoded private key.

If script output says it used an existing public key (for example `Using public key: ...`), use the matching private key for that public key as `SERVER_SSH_KEY`.

`SERVER_SSH_KEY` format notes:
- Recommended: paste raw multi-line private key, including `-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----`.
- Alternative: base64-encode the private key and store that string in `SERVER_SSH_KEY`.
- The key must be unencrypted (no passphrase), because workflow runs non-interactively.

## 3. Add repository secrets

In GitHub repo: `Settings -> Secrets and variables -> Actions -> New repository secret`

Create:
- `SERVER_HOST`: server IP or domain
- `SERVER_USER`: `github-workflow`
- `SERVER_SSH_KEY_B64`: base64 of private SSH key (recommended)
- `SERVER_SSH_KEY`: private SSH key (multi-line content, fallback)
- `SERVER_PORT`: optional SSH port (default `22`)
- `POSTGRES_AUTH_API_PASSWORD`: DB password for `auth_api` role
- `API_DB_PASSWORD`: API runtime DB password (use same value as `POSTGRES_AUTH_API_PASSWORD`)
- `API_MAIL_FROM`: optional sender email (example: `no-reply@example.com`)
- `API_APP_BASE_URL`: optional public base URL used in verification links (example: `https://example.com`)
- `API_SMTP_HOST`: optional SMTP host for email delivery (example: `smtp.mailgun.org`)
- `API_SMTP_PORT`: optional SMTP port (default API behavior: `587`)
- `API_SMTP_ENCRYPTION`: optional `tls`, `ssl`, or `none` (default API behavior: `tls`)
- `API_SMTP_USERNAME`: optional SMTP username
- `API_SMTP_PASSWORD`: optional SMTP password

To generate `SERVER_SSH_KEY_B64` on server:

```bash
sudo base64 -w 0 /root/.ssh/github-workflow_github_actions_ed25519
```

## 4. Add app deploy scripts

Place executable scripts in repository `scripts/` directory, for example:
- `scripts/provision.sh`
- `scripts/setup_nginx.sh`
- `scripts/deploy_api.sh`
- `scripts/deploy_quiz.sh`

Deploy apps workflow uploads:
- `scripts/deploy_*.sh` to `/tmp/workflow-artifacts/scripts`
- `app/*` to `/tmp/workflow-artifacts/app`

`deploy_quiz.sh` deploys only prebuilt `app/quiz/dist` artifacts from workflow upload. Server-side build is disabled.

## 5. Setup Nginx workflow

In GitHub: `Actions -> Setup Nginx On Server -> Run workflow`

This workflow uploads:
- `scripts/provision.sh` to `/tmp/workflow-artifacts/scripts`
- `scripts/setup_nginx.sh` to `/tmp/workflow-artifacts/scripts`
- `configs/*` to `/tmp/workflow-artifacts/configs`

Execution:
- Runs `scripts/provision.sh` with `PROVISION_COMPONENTS=nginx`

This workflow requires GitHub secret:
- `API_DB_PASSWORD`

Optional for signup verification email delivery without local MTA:
- `API_SMTP_HOST`
- `API_SMTP_PORT`
- `API_SMTP_ENCRYPTION`
- `API_SMTP_USERNAME`
- `API_SMTP_PASSWORD`

## 6. Setup PostgreSQL workflow

In GitHub: `Actions -> Setup PostgreSQL On Server -> Run workflow`

No inputs required.

This workflow uploads:
- `scripts/provision.sh` to `/tmp/workflow-artifacts/scripts`
- `scripts/setup_postgresql.sh` to `/tmp/workflow-artifacts/scripts`
- `configs/*` to `/tmp/workflow-artifacts/configs`

Execution:
- Runs `scripts/provision.sh` with `PROVISION_COMPONENTS=postgresql`

Database creation behavior:
- Script executes `configs/postgresql/init.sql`
- API role `auth_api` password is set from `POSTGRES_AUTH_API_PASSWORD`

This workflow requires GitHub secret:
- `POSTGRES_AUTH_API_PASSWORD`

## 7. Deploy apps workflow

In GitHub: `Actions -> Deploy Apps On Server -> Run workflow`

Input:
- Dropdown `apps` values:
  - `all`
  - `quiz`
  - `api`

Mapping:
- `quiz` runs `scripts/deploy_quiz.sh`
- `api` runs `scripts/deploy_api.sh`

This workflow uploads:
- `scripts/provision.sh` to `/tmp/workflow-artifacts/scripts`
- `scripts/deploy_*.sh` to `/tmp/workflow-artifacts/scripts`
- `app/*` to `/tmp/workflow-artifacts/app`

For `quiz`, build is executed on GitHub runner (`npm ci && npm run build`) before upload.

Execution:
- `apps=all` runs `scripts/provision.sh` with `PROVISION_COMPONENTS=apps` (runs all `deploy_*.sh`)
- `apps=quiz` runs `scripts/provision.sh` with `PROVISION_COMPONENTS=quiz`
- `apps=api` runs `scripts/provision.sh` with `PROVISION_COMPONENTS=api`

## 8. Test API workflow

In GitHub: `Actions -> Test API In QEMU -> Run workflow`

Input:
- `require_db_checks`:
  - `1` (default): includes verify-success test that reads token from PostgreSQL
  - `0`: skips DB-backed verify-success test if DB access is unavailable
- `require_email_checks`:
  - `1` (default): requires successful verification email delivery in signup flow
  - `0`: allows signup-related tests to skip when email delivery is unavailable

Execution:
- Starts a fresh local QEMU VM on GitHub runner
- Provisions it via `scripts/qemu.sh start` (shared `scripts/provision.sh` flow)
- Runs API tests via `scripts/qemu.sh test-api`

When `require_email_checks=1`, set SMTP-related secrets so signup email delivery can succeed:
- `API_SMTP_HOST` (required for strict email checks)
- `API_SMTP_PORT`
- `API_SMTP_ENCRYPTION`
- `API_SMTP_USERNAME`
- `API_SMTP_PASSWORD`
- `API_MAIL_FROM`
