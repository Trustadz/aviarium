# Deployment and recovery

## Install

Copy `docker-compose.yml` and `.env.example` to your server. Rename the environment file to `.env`, set `PUBLIC_ORIGIN` to your Aviarium URL, and generate a password for `POSTGRES_PASSWORD`.

```sh
openssl rand -hex 32
```

Compose starts `aviarium` and `aviarium-db`. Both containers have health checks. The app uses `ghcr.io/trustadz/aviarium:latest` and handles database migrations, puzzle jobs, and backups internally.

Compose maps two directories on the host, relative to `docker-compose.yml`.

| Host directory | Content | Optional override |
|---|---|---|
| `./data/postgres` | PostgreSQL's live database files | `POSTGRES_STORAGE` |
| `./data/backups` | Aviarium's backup archives | `BACKUP_STORAGE` |

The containers initialize missing directories on first start. Use dedicated directories for both mounts. If you select an existing backup directory, make it writable by the app's UID 1000. Use the generated archives for database backups. `DATABASE_URL` is optional for an externally managed PostgreSQL database.

GHCR requires a one-time host sign-in for the private image. Use a GitHub token with `read:packages` and access to the Aviarium package. Once Docker has the credential, normal startup and updates use Compose.

```sh
docker login ghcr.io
docker compose up -d
```

Use `docker compose ps` to see when both services are healthy.

## Custom URL

Point your existing reverse proxy at the application's loopback port and configure HTTPS on the proxy. Set `PUBLIC_ORIGIN` to the external origin without a path, for example `https://puzzles.example.org`. If the proxy runs on another host, set `APP_BIND` to an interface it can reach.

## Connect Pocket ID

1. In Pocket ID, go to **Administration → OIDC Clients → Add OIDC Client**. Name it **Aviarium**, select **Confidential**, and enter your Aviarium URL followed by `/api/auth/callback` as the callback. For example, register `https://puzzles.example.org/api/auth/callback`. Enable PKCE if your Pocket ID version exposes that option.
2. In the client's **Access** tab, allow the appropriate groups or select All Users. Copy the client ID and secret into Aviarium's `.env` file. [Pocket ID client setup](https://pocket-id.org/docs/setup/connect-an-app)
3. Set Aviarium's public URL and the base HTTPS URL of Pocket ID in the same `.env` file.

   ```dotenv
   PUBLIC_ORIGIN=https://puzzles.example.org
   OIDC_ISSUER=https://id.example.org
   OIDC_CLIENT_ID=your-client-id
   OIDC_CLIENT_SECRET=your-client-secret
   ```

4. Run `docker compose up -d`. Open Aviarium and choose **Sign in → Sign in with Pocket ID**.

To grant the first Aviarium admin role, set `OIDC_ADMIN_SUBJECT` to that user's Pocket ID subject before they sign in. Once someone signs in, they appear in **Admin → Users**. New accounts are **User** and can see and play every game. Enable **Sudoku editor** to let that person create, test, and publish Sudoku puzzles. **Admin** grants platform administration and editing access to every game.

## Scheduled backup

The default is `0 3 * * *` UTC with three successful archives retained. The admin page can choose a subfolder within `/backup`, set the five-field UTC schedule, set retention, or request an immediate run. The runner creates valid subfolders on the first run. It never traverses symlinks inside the configured mount. A failed run leaves earlier archives intact. When the folder changes, older archives stay in the old folder.

Find archives on the host in `./data/backups` or the directory set by `BACKUP_STORAGE`. A subfolder selected in Aviarium is relative to that directory.

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
