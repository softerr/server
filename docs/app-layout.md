# App layout

`configs/apps.tsv` lists the web apps. Each row defines the public route, source and deployment paths, database schema, API readiness route, and database checks. The setup, deploy, backup, CI build, and QEMU scripts read this registry instead of maintaining separate app lists.

An app's frontend is in `app/<id>/`. Server files belong in `app/<id>/server/`:

- `schema.sql` creates and grants access to its database tables.
- `nginx.conf` defines its API routes and request size limits.
- `health.php` checks its database schema during API readiness.
- Other PHP files implement its API handlers.

`scripts/deploy_api.sh` assembles a release from the shared `app/api/` code and the registered app server modules. It installs app PHP files under `/var/www/api/apps/<id>/`, while keeping SQL and Nginx configuration out of the web release. The shared API entry points in `app/api/` route requests to those modules.

To add an app, add a registry row, its frontend and server module, and an API entry point if it exposes an API. Run `bash tests/deploy/app_registry.sh` to check registration and route generation.
