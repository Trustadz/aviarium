# Aviarium

A self-hosted, installable puzzle library. Sudoku is the only game in the first release. Everyone plays the same published catalog with the same difficulty grades. Creators can generate drafts and test them on the server before publishing.

## Deploy

Copy `docker-compose.yml` and `.env.example` to your server. Name your local copy of the environment file `.env`, set the password and public URL, then run:

```sh
docker compose up -d
```

Compose runs two services. Aviarium handles its schema upgrades, puzzle jobs, and scheduled backups internally. PostgreSQL runs in its own container. Both services have health checks.

Compose pulls `ghcr.io/trustadz/aviarium:latest`, which tracks the latest public release image. The containers are named `aviarium` and `aviarium-db`. PostgreSQL and backups are stored in `./data/postgres` and `./data/backups` beside the Compose file. See [deployment](docs/deployment.md) and [Pocket ID setup](docs/deployment.md#connect-pocket-id).

## Run from the source checkout

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Configure Pocket ID in `.env`, open [http://localhost:4173](http://localhost:4173), and choose **Login with Pocket ID**.

## Develop and verify

Node 24 and npm are required for host-side tooling.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run dev` serves the frontend with the API proxied to the local Compose application. For write operations from the Vite origin, set the application's `PUBLIC_ORIGIN` to the Vite origin while developing. Use the Compose production build to test PWA installation and offline reopens. `npm run test:smoke` exercises the running production build with Chromium. See [verification](docs/testing.md).

## Publish a release

1. Open a draft PR from a feature branch. Test the local preview and wait for the GitHub checks.
2. When the change is approved, make sure its PR includes the next unused version in `package.json` and `package-lock.json`. Use `npm version 0.1.16 --no-git-tag-version` with the version you intend to release. Merge the approved PR.
3. In GitHub, go to **Actions → Publish container → Run workflow**, choose **main**, enter the package version without the `v` prefix, and run it. The workflow reruns the checks, creates the Git version tag, and publishes the public version and `latest` images.

From a terminal with the GitHub CLI, the same release command is `gh workflow run container.yml --ref main -f version=0.1.16`. Substitute the version on `main`. A repository maintainer can run either method with their regular GitHub access.

## Architecture

- `apps/web` holds the launcher, creator studio, admin screens, IndexedDB, and PWA.
- `apps/server` holds the Fastify API, PostgreSQL migrations, OIDC, puzzle worker, and backup runner.
- `packages/game-sdk` provides renderer-neutral game and result types.
- `packages/sudoku` holds the deterministic rules, versioned save contract, generator, grader, and solver.

See [game registration and data contracts](docs/architecture.md).
