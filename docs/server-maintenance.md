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

## 6. Full database backup

Create compressed custom backup:

```bash
sudo -u postgres pg_dump -Fc -d auth -f /tmp/auth_$(date +%F_%H-%M-%S).dump
```

Create plain SQL backup:

```bash
sudo -u postgres pg_dump -d auth > /tmp/auth_$(date +%F_%H-%M-%S).sql
```

## 7. Restore database backup

From custom backup (`.dump`):

```bash
sudo -u postgres pg_restore -d auth --clean --if-exists /tmp/auth_YYYY-MM-DD_HH-MM-SS.dump
```

From SQL backup (`.sql`):

```bash
sudo -u postgres psql -d auth -f /tmp/auth_YYYY-MM-DD_HH-MM-SS.sql
```

## 8. Run setup/provision scripts manually on server

From repository root:

```bash
cd /home/ubuntu/server
```

Run only PostgreSQL setup:

```bash
sudo POSTGRES_AUTH_API_PASSWORD='your-password' PROVISION_COMPONENTS='postgresql' bash scripts/provision.sh
```

Run only Nginx/PHP setup:

```bash
sudo API_DB_PASSWORD='your-password' PROVISION_COMPONENTS='nginx' bash scripts/provision.sh
```

Deploy only API:

```bash
sudo PROVISION_COMPONENTS='api' bash scripts/provision.sh
```

Deploy only quiz (expects built dist in `app/quiz/dist` or `QUIZ_DIST_DIR` set):

```bash
sudo PROVISION_COMPONENTS='quiz' bash scripts/provision.sh
```

## 9. Quick API check

Health endpoint:

```bash
curl -sS http://127.0.0.1/api
```

Signup test:

```bash
curl -sS -X POST http://127.0.0.1/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"test_user","password":"test_pass","email":"test@example.com"}'
```
