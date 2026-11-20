# Deployment and recovery

## Production configuration

1. Copy `.env.example` to `.env`. Choose a strong PostgreSQL password and set the same password in `DATABASE_URL` with URL encoding. Keep the file private.
2. Set `PUBLIC_ORIGIN` to the public HTTPS origin. Point your external reverse proxy to the loopback published port on the Docker host. For a containerized proxy, attach the application to the proxy's internal network and route to its port 4173. Keep PostgreSQL internal.
3. In the existing Pocket ID instance, create a confidential client with the exact callback `https://your-host/api/auth/callback` and enable PKCE. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_CALLBACK_URL`. The app container must resolve and reach the provider's HTTPS URL.
4. Make the host directory selected by `BACKUP_HOST_DIR` available and writable by UID 1000. Compose mounts it at `/backup` in the backup service.
5. Run `docker compose up -d --build --wait`. Check `/health/ready` through the proxy. Sign in through Pocket ID as the initial administrator.
6. Assign the role from the Docker host using the exact issuer and subject. The subject can be taken from your Pocket ID account configuration. Then reload Aviarium and use **Admin** to grant Creator roles.

```sh
docker compose exec app node dist/apps/server/src/admin.js 'https://id.example.org' 'POCKET_ID_SUBJECT'
```

Admin can open the Studio too. Guest progress is stored under a separate local profile. Export it before signing in and import into the authenticated profile if you want to transfer it.

## Scheduled backup

The default is `0 3 * * *` UTC with three successful archives retained. The admin page can choose a subfolder within `/backup`, set the five-field UTC schedule, set retention, or request an immediate run. The runner creates valid subfolders on the first run. It never traverses symlinks inside the configured mount. A failed run leaves earlier archives intact. When the folder changes, older archives stay in the old folder.

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

Keep the original database available. For a production cutover, have users export any newer local saves they want to retain. Stop app, worker, and backup, switch `DATABASE_URL` to the verified restored database, and start the services. Sign in again and import newer local saves if needed. A save referencing a revision published after the archive was taken needs that level restored before it can sync. Rotate secrets independently if the incident involved credential exposure.
