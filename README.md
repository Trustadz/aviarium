# Aviarium

A self-hosted, installable puzzle library. Sudoku is the only game in the first release. Everyone plays the same published catalog with the same difficulty grades. Creators can generate drafts and test them on the server before publishing.

## Deploy

Copy `docker-compose.yml` and `.env.example` to your server. Name your local copy of the environment file `.env`, set the password, image tag, and public URL, then run:

```sh
docker compose up -d
```

Compose runs two services. Aviarium handles its schema upgrades, puzzle jobs, and scheduled backups internally. PostgreSQL runs in its own container. Both services have health checks.

The default image comes from the private GitHub Container Registry. Sign in to that registry on the host once before pulling it. Acceptance and production can share the same Compose file with separate directories, project names, and image tags. PostgreSQL and backups are stored in `./data/postgres` and `./data/backups` beside the Compose file. See [deployment](docs/deployment.md) and [Pocket ID setup](docs/deployment.md#connect-pocket-id).

## Run from the source checkout

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Open [http://localhost:4173](http://localhost:4173). Open **Sign in** to view account options. A guest can play immediately on a preview with no Pocket ID credentials.

## Develop and verify

Node 24 and npm are required for host-side tooling.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm run dev` serves the frontend with the API proxied to the local Compose application. For write operations from the Vite origin, set the application's `PUBLIC_ORIGIN` to the Vite origin while developing. Use the Compose production build to test PWA installation and offline reopens. `npm run test:smoke` exercises the running production build with Chromium. See [verification](docs/testing.md).

## Architecture

- `apps/web` holds the launcher, creator studio, admin screens, IndexedDB, and PWA.
- `apps/server` holds the Fastify API, PostgreSQL migrations, OIDC, puzzle worker, and backup runner.
- `packages/game-sdk` provides renderer-neutral game and result types.
- `packages/sudoku` holds the deterministic rules, versioned save contract, generator, grader, and solver.

See [game registration and data contracts](docs/architecture.md).
