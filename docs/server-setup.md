# Server Setup with GitHub Actions

First-time setup has one server script and one GitHub workflow. Later deployments use the component workflows without repeating bootstrap.

## 1. Bootstrap the server

Copy only `scripts/bootstrap_server.sh` to a Debian or Ubuntu server. Run it interactively from a trusted console or administrator login, replacing the address and email with your own. It installs MEGAcmd and opens its interactive shell once. Enter `login YOUR_MEGA_EMAIL` there, provide the password and 2FA code at its prompts, then enter `exit --only-shell`. The session is stored on the server for unattended backups. Add the SSH port as a third argument if it is not `22`:

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

In GitHub, run **Actions → Set Up Server → Run workflow**. It builds home, quiz, Musico, and MDB, uploads the API and configuration, and runs `scripts/setup_server.sh` remotely. The remote script:

1. Serves HTTP temporarily for the certificate challenge and obtains a certificate for the host in `SERVER_HOST`.
2. Sets up the shared `auth` and `media` databases plus app-specific `quiz`, `musico`, and `mdb` databases, PHP-FPM, and the email worker, runs restore-checked backups of all five databases and uploads them to MEGA, and configures the final HTTPS Nginx site.
3. Deploys the API, home, quiz, Musico, and MDB.
4. Checks the database backup, token cleanup, and mail timers, HTTPS pages for all web apps, and API readiness endpoint.

The workflow fails at the step that needs attention. Rerunning it reapplies the database schema, Nginx configuration, and apps without deleting user accounts; expired verification tokens are pruned. It reuses a valid certificate with an active renewal timer. Once it succeeds, the site is available over HTTPS at the host in `SERVER_HOST`.

PostgreSQL setup uses `configs/postgresql/init.sql` for the API role and shared databases, then applies the auth and media schemas and each app schema from `configs/apps.tsv`, including MDB's app-local users and databases.

To make the first admin, sign up and verify that account, then run the SQL command in [Server maintenance](server-maintenance.md). New accounts require approval in the home Users page after email verification. Verification queues an email for each active admin.

## Later updates

Use **Deploy Apps On Server** to deploy `api`, `home`, `quiz`, `musico`, `mdb`, or `all` without repeating server setup. The web apps build on the GitHub runner; only their built files are uploaded. API deployment reapplies the auth, media, and app schemas before publishing the new code. Deploying an app also deploys its API endpoint. Each app is checked through Nginx after publication and restored to its previous release if the check fails. Use **Setup Nginx On Server** after adding a new web route or changing web server configuration or runtime settings. The latter workflow runs PHP-FPM and email worker setup before Nginx setup. Those workflows use the same pinned SSH host key and production secrets.

The **Test Deployment** workflow checks shell syntax, atomic app replacement, web app builds, and Nginx configuration. The **Test API On Runner** and **Test API In QEMU** workflows exercise the API with local Mailpit, including email rejection and resend behavior. Require their jobs in branch protection if they should block merges.
