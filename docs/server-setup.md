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

In GitHub, run **Actions → Set Up Server → Run workflow**. It builds the quiz, uploads the API and configuration, and runs `scripts/setup_server.sh` remotely. The remote script:

1. Serves HTTP temporarily for the certificate challenge and obtains a certificate for the host in `SERVER_HOST`.
2. Sets up PostgreSQL and the final HTTPS Nginx site.
3. Deploys the API and quiz.
4. Checks the database and mail timers, HTTPS quiz page, and API readiness endpoint.

The workflow fails at the step that needs attention. Rerunning it reapplies the database schema, Nginx configuration, and apps without deleting user accounts; expired verification tokens are pruned. It reuses a valid certificate with an active renewal timer. Once it succeeds, the site is available over HTTPS at the host in `SERVER_HOST`.

## Later updates

Use **Deploy Apps On Server** to deploy `api`, `quiz`, or `all` without repeating server setup. The quiz builds on the GitHub runner; only its built files are uploaded. Use **Setup PostgreSQL On Server** after database schema changes and **Setup Nginx On Server** after web server configuration or runtime settings change. Those workflows use the same pinned SSH host key and production secrets.

The **Test Deployment** workflow checks shell syntax, atomic app replacement, the quiz build, and Nginx configuration. The **Test API On Runner** and **Test API In QEMU** workflows exercise the API with local Mailpit, including email rejection and resend behavior. Require their jobs in branch protection if they should block merges.
