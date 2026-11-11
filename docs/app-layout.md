# App layout

Each web app registers itself with `app.tsv` in its own directory. The manifest defines its title, public route, deployment target, database, API readiness route, and database checks. The setup, deploy, backup, CI build, and QEMU scripts discover these manifests. The source path and schema path are derived from the app directory. The installed backup service receives a generated registry snapshot at `/etc/softerr/apps.tsv`.

An app's frontend is in `app/<id>/`. Server files belong in `app/<id>/server/`:

- `schema.sql` creates and grants access to its database tables.
- `media.sql`, when present, adds the app's tables to the shared media database.
- `nginx.conf` defines its API routes and request size limits.
- `health.php` checks its database schema during API readiness.
- `entrypoint.php` is copied to the API release as `<id>.php`.
- `token.php` declares token scopes and resource ownership queries when the app supports scoped tokens.
- `delete_user.php` returns SQL statements to run before deleting the account's row in the app database.
- `delete_media_user.php`, when present, returns SQL statements for media database account cleanup.
- `systemd/` contains app-owned service and timer units, installed during API deployment.
- Other PHP files implement its API handlers.

`scripts/deploy_api.sh` assembles a release from the platform `app/api/` code and the registered app server modules. It installs app PHP files under `/var/www/api/apps/<id>/` and copies each app's `entrypoint.php` to `/var/www/api/<id>.php`. SQL, Nginx configuration, and systemd units stay out of the web release.

Musico's `server/handlers.php` and MDB's `server/databases.php` load their smaller PHP modules. Account and transaction helpers live in each app's `common.php`; validation and route handlers live with the data they manage (tracks, playlists, columns, cells, rows, and ordering).

To add an app, place its directory under `app/` with `app.tsv` and its frontend. An app with an API also provides `server/schema.sql`, `server/nginx.conf`, `server/health.php`, and `server/entrypoint.php`. Run `bash tests/deploy/app_registry.sh` to check registration and route generation.

To move an app to its own repository, keep the app directory layout and check out that repository at `app/<id>` during builds and deployments. The manifest remains the registration point. Server modules use the platform API helpers at runtime, while the app owns its routes, schema, token definition, account cleanup, worker units, and build commands. Apps that use another local package must replace that dependency with an external package reference.

The platform invokes an app's `build.sh` to produce `dist/index.html`, and invokes an optional `deploy.sh` for custom deployment. CI runs every `app/*/check.sh` it finds. These hooks own their commands and tool choices.

The repository level `bash scripts/lint.sh` checks PHP and shell files with PHP CLI and ShellCheck. App-specific checks live inside each app's `check.sh`.
