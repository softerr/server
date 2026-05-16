#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash setup_nginx.sh)."
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems (apt-get required)."
  exit 1
fi

echo "Installing nginx and php-fpm..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx php-fpm

echo "Creating web directories..."
mkdir -p /var/www/home /var/www/quiz /var/www/api
chown -R www-data:www-data /var/www/home /var/www/quiz /var/www/api
find /var/www/home /var/www/quiz /var/www/api -type d -exec chmod 755 {} \;

if [[ ! -f /var/www/home/index.html ]]; then
  cat > /var/www/home/index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Home</title>
  </head>
  <body>
    <h1>Home page is working</h1>
  </body>
</html>
EOF
fi

if [[ ! -f /var/www/quiz/index.html ]]; then
  cat > /var/www/quiz/index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Quiz</title>
  </head>
  <body>
    <h1>Quiz page is working</h1>
  </body>
</html>
EOF
fi

if [[ ! -f /var/www/api/index.php ]]; then
  cat > /var/www/api/index.php <<'EOF'
<?php
header('Content-Type: application/json');
echo json_encode(['status' => 'ok', 'message' => 'API is working']);
EOF
fi

echo "Discovering php-fpm socket..."
PHP_FPM_SERVICE="$(systemctl list-unit-files --type=service --no-legend | awk '/^php[0-9.]+-fpm\.service/ {print $1; exit}')"
if [[ -z "${PHP_FPM_SERVICE}" ]]; then
  PHP_FPM_SERVICE="php-fpm.service"
fi

systemctl enable --now "${PHP_FPM_SERVICE}" || true

PHP_SOCK="$(find /run/php -maxdepth 1 -type s -name 'php*-fpm.sock' | head -n 1 || true)"
if [[ -z "${PHP_SOCK}" ]]; then
  echo "Could not find php-fpm socket in /run/php."
  echo "Check php-fpm service status and set fastcgi_pass manually."
  exit 1
fi

echo "Writing nginx site config..."
cat > /etc/nginx/sites-available/softerr <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/home;
    index index.html index.htm index.php;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /quiz {
        return 301 /quiz/;
    }

    location /quiz/ {
        alias /var/www/quiz/;
        try_files \$uri \$uri/ /quiz/index.html;
    }

    location = /api {
        return 301 /api/;
    }

    location /api/ {
        alias /var/www/api/;
        index index.php;
        try_files \$uri \$uri/ /api/index.php?\$query_string;
    }

    location ~ ^/api/(.+\.php)$ {
        alias /var/www/api/\$1;
        include snippets/fastcgi-php.conf;
        fastcgi_param SCRIPT_FILENAME \$request_filename;
        fastcgi_pass unix:${PHP_SOCK};
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/softerr /etc/nginx/sites-enabled/softerr

echo "Validating nginx configuration..."
nginx -t

echo "Restarting services..."
systemctl enable nginx
systemctl restart nginx

echo "Done."
echo "Mapped routes:"
echo "  /      -> /var/www/home"
echo "  /quiz  -> /var/www/quiz"
echo "  /api   -> /var/www/api (PHP)"
