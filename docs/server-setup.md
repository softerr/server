# Server Setup with GitHub Actions

First-time setup has one server script and one GitHub workflow. Later deployments use the component workflows without repeating bootstrap.

## 1. Bootstrap the server

Copy only `scripts/bootstrap_server.sh` to a Debian or Ubuntu server. Run it from a trusted console or administrator login, replacing the address and email with your own. Add the SSH port as a third argument if it is not `22`:

```bash
sudo bash bootstrap_server.sh YOUR_PUBLIC_IP you@example.com
```

The script installs SSH tools if needed, creates the `github-workflow` user and dedicated key, configures its deployment sudo rule, and prints the GitHub values to enter. It reuses its SSH key and generated database password when rerun. No other project files are needed on the server at this stage.

The public address must reach the server on its SSH port and on ports 80 and 443. If you use a domain, point its DNS record to the server before running the GitHub workflow.

## 2. Enter the printed values in GitHub

Create a `production` environment under **Settings → Environments**. Add each line under **Secrets** or **Variables** as labeled by the bootstrap output. In particular, store `SERVER_SSH_KEY_B64` and `SERVER_SSH_KNOWN_HOSTS` as production environment secrets. The SSH key grants effective root access because the workflow user can upload scripts that run through sudo. Restrict the environment to the intended branch and require review if available.

The script prints every value required by the first-time workflow:

| Secrets | Variables |
| --- | --- |
| `SERVER_HOST`, `SERVER_USER`, `SERVER_PORT` | `TLS_CONTACT_EMAIL` |
| `SERVER_SSH_KEY_B64`, `SERVER_SSH_KNOWN_HOSTS` | |
| `API_DB_PASSWORD` | |

The workflows use `API_DB_PASSWORD` for both PostgreSQL and the API. They derive the public HTTPS origin from `SERVER_HOST`, which must be the same host clients use to reach the site. Existing `POSTGRES_AUTH_API_PASSWORD` secrets and `API_APP_BASE_URL` variables are no longer used and can be removed.

For verification email delivery, also add your mail provider settings as production environment secrets: `API_MAIL_FROM`, `API_SMTP_HOST`, `API_SMTP_PORT`, `API_SMTP_ENCRYPTION`, `API_SMTP_USERNAME`, and `API_SMTP_PASSWORD`. The bootstrap cannot generate provider credentials. Without SMTP settings, the worker uses PHP `mail()`, which requires a working local mail transport.

## 3. Run one workflow

In GitHub, run **Actions → Set Up Server → Run workflow**. It builds home and quiz, uploads the API and configuration, and runs `scripts/setup_server.sh` remotely. The remote script:

1. Serves HTTP temporarily for the certificate challenge and obtains a certificate for the host in `SERVER_HOST`.
2. Sets up the shared `auth` and `media` databases plus the app-specific `quiz` database, PHP-FPM, and the email worker, runs verified backups of all three databases, and configures the final HTTPS Nginx site.
3. Deploys the API, home, and quiz.
4. Checks the database backup, token cleanup, and mail timers, HTTPS home and quiz pages, and API readiness endpoint.

The workflow fails at the step that needs attention. Rerunning it reapplies the database schema, Nginx configuration, and apps without deleting user accounts; expired verification tokens are pruned. It reuses a valid certificate with an active renewal timer. Once it succeeds, the site is available over HTTPS at the host in `SERVER_HOST`.

PostgreSQL setup uses `configs/postgresql/init.sql` for the API role and databases, then applies `auth.sql` to `auth`, `quiz.sql` to `quiz`, and `media.sql` to `media`. Existing quiz images are copied into `media` with their IDs preserved so saved questions keep working.

On an upgraded server, the old `quiz.image` table remains available for API rollback; the new API reads and writes `media`. Setup tracks copied legacy IDs and copies any images written by a rolled-back API on a later run.

To make the first admin, sign up and verify that account, then run the SQL command in [Server maintenance](server-maintenance.md). New accounts require approval in the home Users page after email verification. Verification queues an email for each active admin.

When upgrading an existing auth database, already verified accounts are approved once so their sessions continue to work. Existing unverified accounts remain pending after verification.

## Later updates

For this media upgrade on an existing server, run **Setup PostgreSQL On Server**, then **Setup Nginx On Server**, then **Deploy Apps On Server** with `all`. The database step copies existing image IDs before the new API reads from `media`.

Use **Deploy Apps On Server** to deploy `api`, `home`, `quiz`, or `all` without repeating server setup. The home and quiz apps build on the GitHub runner; only their built files are uploaded. Each app is checked through Nginx after publication and restored to its previous release if the check fails. Run **Setup PostgreSQL On Server** before deploying API code that needs a new database column, such as account roles. Use **Setup Nginx On Server** after web server configuration or runtime settings change. The latter workflow runs PHP-FPM and email worker setup before Nginx setup. Those workflows use the same pinned SSH host key and production secrets.

The **Test Deployment** workflow checks shell syntax, atomic app replacement, both web app builds, and Nginx configuration. The **Test API On Runner** and **Test API In QEMU** workflows exercise the API with local Mailpit, including email rejection and resend behavior. Require their jobs in branch protection if they should block merges.
