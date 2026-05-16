# GitHub Workflow Server Setup

This project includes:
- Workflow: `.github/workflows/setup-nginx.yml`
- Workflow: `.github/workflows/setup-postgresql.yml`
- Workflow: `.github/workflows/deploy-apps.yml`
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

To generate `SERVER_SSH_KEY_B64` on server:

```bash
sudo base64 -w 0 /root/.ssh/github-workflow_github_actions_ed25519
```

## 4. Add app deploy scripts

Place executable scripts in repository `scripts/` directory, for example:
- `scripts/setup_nginx.sh`
- `scripts/deploy_api.sh`
- `scripts/deploy_quiz.sh`

Deploy apps workflow uploads:
- `scripts/deploy_*.sh` to `/tmp/workflow-artifacts/scripts`
- `app/*` to `/tmp/workflow-artifacts/app`

`deploy_quiz.sh` deploys only prebuilt `app/quiz/dist` artifacts from workflow upload. Server-side build is disabled.

## 5. Setup Nginx workflow

In GitHub: `Actions -> Setup Nginx On Server -> Run workflow`

Input:
- `template_path` (default: `/tmp/workflow-artifacts/configs/nginx/softerr.conf.template`)

This workflow uploads:
- `scripts/setup_nginx.sh` to `/tmp/workflow-artifacts/scripts`
- `configs/*` to `/tmp/workflow-artifacts/configs`

## 6. Setup PostgreSQL workflow

In GitHub: `Actions -> Setup PostgreSQL On Server -> Run workflow`

Inputs:
- `db_name` (default: `app`)
- `db_owner` (default: `postgres`)

This workflow uploads:
- `scripts/setup_postgresql.sh` to `/tmp/workflow-artifacts/scripts`
- `configs/*` to `/tmp/workflow-artifacts/configs`

## 7. Deploy apps workflow

In GitHub: `Actions -> Deploy Apps On Server -> Run workflow`

Input:
- `apps=all` runs all scripts matching `scripts/deploy_*.sh`
- Or specify app names, comma-separated: `quiz,api`

Mapping:
- `quiz` runs `scripts/deploy_quiz.sh`
- `api` runs `scripts/deploy_api.sh`

This workflow uploads:
- `scripts/deploy_*.sh` to `/tmp/workflow-artifacts/scripts`
- `app/*` to `/tmp/workflow-artifacts/app`

For `quiz`, build is executed on GitHub runner (`npm ci && npm run build`) before upload.
