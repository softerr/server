# Server Maintenance

This guide contains routine maintenance commands for the deployed server.

Assumptions:
- Ubuntu server
- Services managed by `systemd`
- Project path: `/home/ubuntu/server`
- PostgreSQL DB: `auth`

## 1. Service health

Check service status:

```bash
sudo systemctl status nginx
sudo systemctl status postgresql
sudo systemctl status php8.3-fpm || sudo systemctl status php-fpm
```

Restart services:

```bash
sudo systemctl restart nginx
sudo systemctl restart postgresql
sudo systemctl restart php8.3-fpm || sudo systemctl restart php-fpm
```

## 2. Logs

Nginx logs:

```bash
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
```

Service logs (journal):

```bash
sudo journalctl -u nginx -n 200 --no-pager
sudo journalctl -u postgresql -n 200 --no-pager
sudo journalctl -u php8.3-fpm -n 200 --no-pager || sudo journalctl -u php-fpm -n 200 --no-pager
```

## 3. PostgreSQL CLI access

Open psql as postgres superuser:

```bash
sudo -u postgres psql
```

Open `auth` database directly:

```bash
sudo -u postgres psql -d auth
```

Inside `psql`, useful commands:

```sql
\l
\dt
\d public."user"
\d public.user_token
```

Run a single SQL command directly from shell:

```bash
sudo -u postgres psql -d auth -c "SELECT 1;"
```

More examples:

```bash
sudo -u postgres psql -d auth -c "SELECT COUNT(*) FROM public.\"user\";"
sudo -u postgres psql -d auth -c "UPDATE public.\"user\" SET verified = TRUE WHERE id = 1;"
```

Accounts start with the `user` role. To grant an existing account the `admin`
or `mod` role, connect as the PostgreSQL administrator and update that account:

```bash
sudo -u postgres psql -d auth
```

```sql
UPDATE public."user" SET role = 'admin' WHERE email = 'admin@example.com'
RETURNING id, email, role;
```

The available roles are `admin`, `mod`, and `user`. Refresh the home app after
changing a role; it reads the current role from `/api/auth/me` on page load.
The Users navbar item is visible to admins. Once the first admin is assigned
through PostgreSQL, that admin can change other accounts' roles in the Users
table. An admin cannot change their own role there.
Admins can also delete other accounts from that table. Deletion removes the
auth account and its quiz data. If cleanup fails, the account remains blocked
and visible in the Users table so deletion can be retried.

## 4. Dump one table

Dump `public."user"` table (SQL format):

```bash
sudo -u postgres pg_dump -d auth -t 'public."user"' > /tmp/auth_user_table.sql
```

Dump `public.user_token` table:

```bash
sudo -u postgres pg_dump -d auth -t public.user_token > /tmp/auth_user_token_table.sql
```

## 5. Export table rows to CSV

Export users to CSV:

```bash
sudo -u postgres psql -d auth -c "\copy (SELECT * FROM public.\"user\" ORDER BY id) TO '/tmp/auth_user.csv' CSV HEADER"
```

Export tokens to CSV:

```bash
sudo -u postgres psql -d auth -c "\copy (SELECT * FROM public.user_token ORDER BY id) TO '/tmp/auth_user_token.csv' CSV HEADER"
```

## 6. Verified database backups

PostgreSQL setup installs `softerr-backup-postgresql.timer`. It runs daily after 03:00 server time, makes a custom-format dump of `auth`, restores the dump into a temporary database, checks the expected tables, and only then publishes the archive under `/var/backups/softerr`. The directory is accessible only to `postgres` and root. Verified archives are kept for 30 days. A failed dump or restore leaves earlier backups in place and makes the service fail. Keep enough free disk space for both the archive and a temporary restored copy of the database.

Check the timer, run a backup now, and inspect the result:

```bash
sudo systemctl list-timers softerr-backup-postgresql.timer
sudo systemctl start softerr-backup-postgresql.service
sudo journalctl -u softerr-backup-postgresql.service -n 100 --no-pager
sudo ls -lh /var/backups/softerr/*.dump
```

These are local backups. Copy them to storage outside the server for protection against host or disk loss. Preserve the archive's restricted access because it contains account data and password hashes. The database role and password also need to be recreated from the bootstrap and setup workflow during disaster recovery.

## 7. Restore a backup for inspection

The scheduled job performs a full restore check automatically. To inspect a selected archive manually, restore it into a separate database, then remove that database when finished:

```bash
sudo -u postgres createdb -T template0 auth_recovery_check
sudo -u postgres pg_restore --exit-on-error -d auth_recovery_check /var/backups/softerr/AUTH_ARCHIVE.dump
sudo -u postgres psql -d auth_recovery_check -c 'SELECT COUNT(*) FROM public."user";'
sudo -u postgres dropdb auth_recovery_check
```

This does not modify the live `auth` database. For a production recovery, keep the application stopped while validating and switching databases.

## 8. Timers and redeployment

Use **Set Up Server** for first-time setup. For later changes, run **Setup PostgreSQL On Server**, **Setup Nginx On Server**, or **Deploy Apps On Server** in GitHub Actions. These workflows upload the required files and use the same production environment values. Nginx setup validates staged site and route files before installation, then checks the full configuration and restores the previous files if activation fails.

PostgreSQL setup installs `softerr-prune-user-tokens.timer` to remove expired verification tokens daily. Check its next run with `systemctl list-timers softerr-prune-user-tokens.timer`, or run cleanup immediately with `sudo systemctl start softerr-prune-user-tokens.service`.

The backup timer is installed by the same setup workflow and performs a restore check after each dump. Investigate failures with `sudo journalctl -u softerr-backup-postgresql.service -n 100 --no-pager`.

Email worker setup installs `softerr-send-email.timer` to deliver queued verification emails every minute. Check it with `systemctl list-timers softerr-send-email.timer` and inspect delivery failures with `sudo journalctl -u softerr-send-email.service -n 100 --no-pager`.

API and quiz deployments prepare a complete directory beside the live app, then atomically exchange the two directories. The API deployment restarts PHP-FPM to load the new code. Before removing the old release, the deployment checks the API readiness response or compares the served quiz page with the new build. A failed check swaps the previous app directory back and makes the workflow fail. The apps are checked and rolled back independently. Production setup and deployment workflows run one at a time. The server needs Python 3 and a Linux filesystem that supports `renameat2` directory exchange; deployment fails without changing the live app if the exchange is unsupported.

## 9. Quick API check

Health endpoint:

```bash
curl -fsS https://example.com/api/
```

Signup test:

```bash
curl -fsS -X POST https://example.com/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"test_user","password":"test_pass","email":"test@example.com"}'
```
