# Server Maintenance

This guide contains routine maintenance commands for the deployed server.

Assumptions:
- Ubuntu server
- Services managed by `systemd`
- Project path: `/home/ubuntu/server`
- PostgreSQL databases: `auth`, `quiz`, `media`

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
UPDATE public."user" SET role = 'admin', approved_at = CURRENT_TIMESTAMP
WHERE email = 'admin@example.com' AND verified = TRUE
RETURNING id, email, role, approved_at;
```

The first admin must verify their email before this bootstrap command. New
accounts cannot log in until an approved admin approves them in Users.
The available roles are `admin`, `mod`, and `user`. Refresh the home app after
changing a role; it reads the current role from `/api/auth/me` on page load.
The Users navbar item is visible to admins. Once the first admin is assigned
through PostgreSQL, that admin can change other accounts' roles in the Users
table. An admin cannot change their own role there.
Admins can also delete other accounts from that table. Deletion removes the
auth account, quiz data, and personal media images. If cleanup fails, the account remains blocked
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

## 6. Verified backups

PostgreSQL setup installs `softerr-backup-postgresql.timer`. It runs daily after 03:00 server time, dumps `auth`, `media`, `quiz`, `musico`, and `mdb`, restores each dump into a temporary database, checks the expected tables, and uploads it to `/softerr-backups` in MEGA. It also archives the private files in `/var/lib/softerr/media` as `media-files.tar` and compares the archive contents with the source files. A complete backup set includes both `media.dump` and `media-files.tar`; restore both to recover images and audio. The temporary local archives are removed after MEGA reports the expected sizes. Failed uploads remain in `/var/backups/softerr` for retry. MEGA keeps up to 7 days and 7 archives per database, except `media` and `media-files`, which keep one each. A failed dump, restore, archive check, or upload makes the service fail. Keep enough temporary disk space for a dump, its restored database, a media TAR, and an admin download ZIP. The MEGA session belongs to `www-data` under `/var/lib/softerr-mega`; bootstrap opens the interactive MEGAcmd shell once; use `login YOUR_MEGA_EMAIL`, answer its password and 2FA prompts, then `exit --only-shell`. Do not log this account out while automated backups are in use.

Images and audio are stored as private files; PostgreSQL holds their hashes, sizes, and ownership. The media database dump skips compression and its restore check uses two parallel jobs. On the first deployment after this storage change, API deployment copies legacy database bytes to private files while the old API is running, pauses PHP-FPM for a final catch-up, verifies the new release, and then removes the old byte columns. Keep enough free disk space for both copies during this one-time transition.

While legacy byte columns remain, database backups continue but no modern `media-files.tar` set is published. After migration, API deployment starts a new verified backup in the background. Check its completion with `sudo systemctl status softerr-backup-postgresql.service` before relying on the new backup set.

Dropped byte columns disappear from new dumps immediately. PostgreSQL may retain their old disk space until the table is rewritten; plan that maintenance separately if server disk space is tight.

Server setup reuses a complete MEGA backup set from the past two days when the daily timer is enabled and its last backup succeeded. It runs the full backup and restore check during first-time setup or if that check fails. Data changed after the reused backup is not covered until the next scheduled backup.

Check the timer, run a backup now, and inspect the result:

```bash
sudo systemctl list-timers softerr-backup-postgresql.timer
sudo systemctl start softerr-backup-postgresql.service
sudo journalctl -u softerr-backup-postgresql.service -n 100 --no-pager
sudo -u www-data env HOME=/var/lib/softerr-mega mega-ls -l /softerr-backups
```

An admin can list and download a complete backup set as a ZIP from **Home → Backups**. The server downloads the selected archives to a temporary directory to assemble the ZIP, then removes those temporary files. Keep the ZIP private because it contains account data and password hashes. The database role and password also need to be recreated during disaster recovery. To move an existing server to MEGA backups, rerun `bootstrap_server.sh` interactively to install MEGAcmd and sign in, then run **Setup PostgreSQL On Server**.

## 7. Restore a backup for inspection

The scheduled job performs a full restore check automatically. To inspect a selected archive manually, restore it into a separate database, then remove that database when finished:

```bash
sudo -u postgres createdb -T template0 auth_recovery_check
sudo install -d -o www-data -g postgres -m 750 /var/backups/softerr/restore
sudo -u www-data env HOME=/var/lib/softerr-mega mega-get /softerr-backups/AUTH_ARCHIVE.dump /var/backups/softerr/restore
sudo -u postgres pg_restore --exit-on-error -d auth_recovery_check /var/backups/softerr/restore/AUTH_ARCHIVE.dump
sudo -u postgres psql -d auth_recovery_check -c 'SELECT COUNT(*) FROM public."user";'
sudo -u postgres dropdb auth_recovery_check
sudo rm -f /var/backups/softerr/restore/AUTH_ARCHIVE.dump
sudo rmdir /var/backups/softerr/restore
```

This does not modify the live `auth` database. For a production recovery, keep the application stopped while validating and switching databases.

To inspect media files from the same backup set, extract `media-files.tar` into a separate directory:

```bash
sudo install -d -o www-data -g www-data -m 750 /var/backups/softerr/restore
sudo -u www-data env HOME=/var/lib/softerr-mega mega-get /softerr-backups/MEDIA_FILES_ARCHIVE.tar /var/backups/softerr/restore
sudo install -d -m 700 /var/backups/softerr/media-restore-check
sudo tar -xf /var/backups/softerr/restore/MEDIA_FILES_ARCHIVE.tar -C /var/backups/softerr/media-restore-check
```

Restore the extracted `images`, `thumbnails`, and `audio` directories under `/var/lib/softerr/media` together with `media.dump` when recovering production; current media database dumps contain no image or audio bytes.

## 8. Timers and redeployment

Use **Set Up Server** for first-time setup. For later changes, run **Setup PostgreSQL On Server**, **Setup Nginx On Server**, or **Deploy Apps On Server** in GitHub Actions. These workflows upload the required files and use the same production environment values. Nginx setup validates staged site and route files before installation, then checks the full configuration and restores the previous files if activation fails.

PostgreSQL setup installs `softerr-prune-user-tokens.timer` to remove expired verification tokens daily. Check its next run with `systemctl list-timers softerr-prune-user-tokens.timer`, or run cleanup immediately with `sudo systemctl start softerr-prune-user-tokens.service`.

The backup timer is installed by the same setup workflow and performs a restore check after each dump. Investigate failures with `sudo journalctl -u softerr-backup-postgresql.service -n 100 --no-pager`.

Email worker setup installs `softerr-send-email.timer` to deliver queued account emails, including admin approval notices, every minute. Check it with `systemctl list-timers softerr-send-email.timer` and inspect delivery failures with `sudo journalctl -u softerr-send-email.service -n 100 --no-pager`.

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
