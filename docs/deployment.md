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

The container image is public. Start Aviarium with Compose.

```sh
docker compose up -d
```

Use `docker compose ps` to see when both services are healthy.

## Custom URL

Point your existing reverse proxy at the application's loopback port and configure HTTPS on the proxy. Set `PUBLIC_ORIGIN` to the external origin without a path, for example `https://puzzles.example.org`. If the proxy runs on another host, set `APP_BIND` to an interface it can reach.

On iPhone or iPad, open that HTTPS URL in Safari. Use **Share → Add to Home Screen**, turn on **Open as Web App** if offered, and tap **Add**. Launch Aviarium from its new Home Screen icon. [Apple’s iPhone instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

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

4. Run `docker compose up -d`. Open Aviarium and choose **Login with Pocket ID**. Sign-in is required to open the library.

To grant the first Aviarium admin role, set `OIDC_ADMIN_SUBJECT` to that user's Pocket ID subject before they sign in. Once someone signs in, they appear in **Account menu → Administration → Users**. New accounts are **User** and can see and play every game. Saves and game preferences sync with the signed-in account. Set the account role to **Editor** to let that person create, test, and publish puzzles for every game. **Admin** adds platform administration. Existing accounts with a game-specific editor grant upgrade to **Editor**.

Open **News** from the main navigation to read announcements. An admin can publish an Aviarium update, new content, or a new game announcement there, with an optional header image and expandable details. Signed-in users can like each post once. The account menu opens **Device settings** and **Account settings**, where players can change their display name or upload an avatar. Aviarium imports the Pocket ID picture on sign-in when the provider includes it in the profile claims. A custom avatar takes precedence. [Pocket ID scopes and claims](https://pocket-id.org/docs/guides/scopes-and-claims)

## Test without Pocket ID

To test Studio or administration, set `TEST_ENVIRONMENT=true` in your localhost deployment's `.env`, then run `docker compose up -d`. Keep `APP_BIND` on loopback and use a database dedicated to the test deployment. The server creates a test account for the browser and defaults to **User**. In the library, open **Account menu → Device settings → Test user role** to switch between **User**, **Editor**, and **Admin**. Drafts and progress stay with the same test account when you switch roles. Test mode takes precedence over Pocket ID and defaults to `false`.

For browser-only play, set `LOGIN_ENABLED=false` with `TEST_ENVIRONMENT=false`. Saves, completions, and preferences stay in the browser's local profile. Account and editor features require a server session. Login defaults to `true`.

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

## Languages and announcement translation

Set `AVIARIUM_ENABLED_LOCALES` to `en,nl`, `en`, or `nl` and recreate the app
container to change which interface languages visitors can select. The first
configured language is the fallback for visitors whose browser languages are
unavailable. Both interface catalogs ship with Aviarium for offline use.
Players choose their language under **Account settings**. The choice follows
their account across browsers and syncs after reconnecting. Local play uses
**Player settings**.

Official announcements require English and Dutch even when only one language is
enabled. Set `OPENAI_API_KEY` and `AVIARIUM_TRANSLATION_MODEL` in the app's
environment to enable AI draft generation in the admin news editor. Choose a
model that supports structured outputs in the Responses API. The worker sends
the source announcement text and optional image description to OpenAI. Admins
can review or replace the draft before publishing, or enter both versions
manually without configuring AI.

The migration translates the bundled release announcements and preserves
existing site-authored posts. Use **Edit translations** on any older
English-only announcement to review and publish its Dutch version.
