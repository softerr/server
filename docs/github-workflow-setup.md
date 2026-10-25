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
- Creates sudoers rules for scripts under `/tmp/workflow-artifacts/runs/<run-id>-<attempt>/scripts/` (and the legacy shared path)

The workflow user can upload scripts into those directories and run them as root. Treat its SSH private key as a root credential. The bootstrap creates a dedicated keypair by default; it no longer reuses an administrator's personal or root SSH key. `--pubkey` and `--pubkey-file` remain available when you supply a dedicated key yourself.

If the workflow user already exists, rerun this bootstrap script before using the updated workflows so its sudoers rule includes run-specific paths.
Rerunning adds the dedicated public key but does not remove older keys. After switching the GitHub secret, remove any obsolete personal keys from the workflow user's `authorized_keys`.

## 2. Configure SSH key for GitHub Actions

You must set `SERVER_SSH_KEY` to a private key matching the public key installed by step 1.

If script output says it generated a keypair, print private key from server:

```bash
sudo cat /root/.ssh/github-workflow_github_actions_ed25519
```

Copy that full output into the `production` environment secret `SERVER_SSH_KEY`.
Recommended alternative (less formatting risk): set `SERVER_SSH_KEY_B64` as a `production` environment secret with the base64-encoded private key.

If you supplied `--pubkey` or `--pubkey-file`, use the matching dedicated private key.

`SERVER_SSH_KEY` format notes:
- Recommended: paste raw multi-line private key, including `-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----`.
- Alternative: base64-encode the private key and store that string in `SERVER_SSH_KEY`.
- The key must be unencrypted (no passphrase), because workflow runs non-interactively.

## 3. Protect deployment access and add secrets

Create a `production` environment in the repository's `Settings -> Environments`. The Nginx, PostgreSQL, and app deployment jobs reference it. Restrict deployment to the intended branch and require a reviewer where your GitHub plan supports that rule. An environment name alone does not enforce a review or branch restriction.

Store `SERVER_SSH_KEY_B64` (or `SERVER_SSH_KEY`) as a **production environment secret**, then remove any repository-scoped copy of that private key. Repository secrets remain available to other workflows, while an environment secret is released to its jobs only after the environment's configured protection rules pass.

Create the remaining values under `Settings -> Secrets and variables -> Actions`, using environment secrets for production-only credentials:

Secret names used by the workflows:
- `SERVER_HOST`: server IP or domain
- `SERVER_USER`: `github-workflow`
- `SERVER_SSH_KEY_B64`: base64 of private SSH key (recommended)
- `SERVER_SSH_KEY`: private SSH key (multi-line content, fallback)
- `SERVER_PORT`: optional SSH port (default `22`)
- `POSTGRES_AUTH_API_PASSWORD`: DB password for `auth_api` role
- `API_DB_PASSWORD`: API runtime DB password (use same value as `POSTGRES_AUTH_API_PASSWORD`)
- `API_MAIL_FROM`: optional sender email (example: `no-reply@example.com`)
- `API_APP_BASE_URL`: required public origin used in verification links (example: `https://example.com`); use HTTPS for a public server
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

Each GitHub workflow run stages files under `/tmp/workflow-artifacts/runs/<run-id>-<attempt>` and removes that directory after the remote script runs. Concurrent uploads use separate directories.
For manual use of the CI helper scripts, set the same unique `REMOTE_DIR` for both upload and execution; the manual default remains the legacy shared path.

Deploy apps workflow uploads:
- `scripts/provision.sh` and only the selected app's deploy script(s)
- `app/api/*` for API deployments
- built `app/quiz/dist/*` for quiz deployments

`deploy_quiz.sh` deploys only prebuilt `app/quiz/dist` artifacts from workflow upload. Server-side build is disabled.

## 5. Setup Nginx workflow

In GitHub: `Actions -> Setup Nginx On Server -> Run workflow`

This workflow uploads:
- `scripts/provision.sh` to the run's `scripts/` directory
- `scripts/setup_nginx.sh` to the run's `scripts/` directory
- `configs/*` to the run's `configs/` directory

Execution:
- Runs `scripts/provision.sh` with `PROVISION_COMPONENTS=nginx`

This workflow requires GitHub secret:
- `API_DB_PASSWORD`
- `API_APP_BASE_URL`

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
- `scripts/provision.sh` to the run's `scripts/` directory
- `scripts/setup_postgresql.sh` to the run's `scripts/` directory
- `configs/*` to the run's `configs/` directory

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
- `scripts/provision.sh` and only the selected app's deploy script(s)
- `app/api/*` when `apps=api` or `apps=all`
- built `app/quiz/dist/*` when `apps=quiz` or `apps=all`

For `quiz` and `all`, the quiz build runs on the GitHub runner (`npm ci && npm run build`) before upload. API-only deployments skip the Node build. `node_modules` is never uploaded.

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
