# Deployment and recovery

## Acceptance and production

Use the same `docker-compose.yml` in both environments. Copy `.env.example` as `.env` and set the variables for that environment.

| Setting | Acceptance example | Production example |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `aviarium-accept` | `aviarium-prod` |
| `AVIARIUM_IMAGE` | `ghcr.io/trustadz/aviarium:acceptance` | `ghcr.io/trustadz/aviarium:v0.1.2` |
| `APP_PORT` | `4183` | `4173` |
| `PUBLIC_ORIGIN` | `https://puzzles-accept.example.org` | `https://puzzles.example.org` |

Compose starts Aviarium and PostgreSQL. Both have health checks. Aviarium runs schema migrations at startup and handles puzzle jobs and backups in the app container.

Set a strong `POSTGRES_PASSWORD`. A named backup volume is created automatically. To store backups in a host directory instead, set `BACKUP_STORAGE` to an existing absolute path writable by UID 1000. `DATABASE_URL` is optional for an externally managed PostgreSQL database.

GHCR requires a one-time host sign-in for the private image. Use a GitHub token with `read:packages` and access to the Aviarium package. Once Docker has the credential, normal startup and updates use Compose.

```sh
docker login ghcr.io
docker compose up -d --wait
```

For updates on a moving tag, run `docker compose pull` followed by `docker compose up -d --wait`. Main publishes the moving `acceptance` tag and a `sha-<commit>` tag. Production can pin the accepted SHA or a version tag. A Git version tag promotes the already published image for that commit.

If your existing stack has separate migration, worker, and backup services, use `docker compose up -d --wait --remove-orphans` on the first upgrade. Keep the same project name and backup storage setting to retain the existing database and archives. Use the matching image and Compose file from the same release.

## Custom URL and Pocket ID

Point your existing reverse proxy at the application's loopback port, and configure HTTPS on the proxy. Set `PUBLIC_ORIGIN` to the external origin with no path. If the proxy runs on another host, set `APP_BIND` to an interface it can reach. The default loopback bind keeps the app behind a host proxy and PostgreSQL remains internal.

Register a confidential client in your existing Pocket ID instance and enable PKCE. Register its exact callback, such as `https://puzzles.example.org/api/auth/callback`. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. Aviarium derives the callback from `PUBLIC_ORIGIN`. Acceptance and production can have separate Pocket ID clients. The container must be able to reach the issuer over HTTPS.

Set `OIDC_ADMIN_SUBJECT` to the subject of the initial administrator before their first sign-in, or promote an existing account from the Docker host:

```sh
docker compose exec app node dist/apps/server/src/admin.js 'https://id.example.org' 'POCKET_ID_SUBJECT'
```

Sign in to grant other users access through **Admin**. Each Pocket ID identity has a separate account, roles, and progress. **Switch account** requests Pocket ID's account chooser. **Sign out** ends the Aviarium session on that browser. Device display settings stay in the browser across account changes.

## Scheduled backup

The default is `0 3 * * *` UTC with three successful archives retained. The admin page can choose a subfolder within `/backup`, set the five-field UTC schedule, set retention, or request an immediate run. The runner creates valid subfolders on the first run. It never traverses symlinks inside the configured mount. A failed run leaves earlier archives intact. When the folder changes, older archives stay in the old folder.

With the default backup volume, copy an archive to the host with `docker compose cp app:/backup/ARCHIVE.dump ./ARCHIVE.dump`. Include the configured subfolder in the source path if you use one.

The archive contains Aviarium's PostgreSQL database. Pocket ID passkeys and data still need their own backups. Compose configuration, credentials, and the application image are also separate. Keep a copy of the release source and configuration with the backup policy. Backups on the same physical disk share its failure risk.

## Restore into a fresh database

Keep traffic away from the restore target until verification is complete. Limit these commands to a newly created database. Replace the archive path with a file from the host backup folder.

```sh
docker compose exec -T db createdb -U aviarium aviarium_restored
docker compose exec -T db pg_restore --exit-on-error --no-owner --no-acl \
  -U aviarium -d aviarium_restored < /path/to/aviarium-archive.dump
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U aviarium -d aviarium_restored <<'SQL'
TRUNCATE auth_sessions, login_attempts;
UPDATE backup_config SET requested_at=NULL, last_attempt=NULL, error=NULL, archives='[]'::jsonb, schedule_since=now();
SELECT count(*) AS accounts FROM users;
SELECT count(*) AS published_revisions FROM published_levels;
SELECT count(*) AS saves FROM saves;
SQL
```

Keep the original database available. For a production cutover, have users export any newer local saves they want to retain. Stop `app`, switch `DATABASE_URL` to the verified restored database, and start the services. Sign in again and import newer local saves if needed. A save referencing a revision published after the archive was taken needs that level restored before it can sync. Rotate secrets independently if the incident involved credential exposure.
