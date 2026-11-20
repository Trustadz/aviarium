# Aviarium

A self-hosted, installable puzzle library. Sudoku is the only game in the first release. Everyone plays the same published catalog with the same difficulty grades. Creators can generate drafts and test them on the server before publishing.

## Run locally

Requires Docker with Compose. The application binds to loopback by default.

```sh
cp .env.example .env
mkdir -p backup
docker compose up -d --build --wait
```

Open [http://localhost:4173](http://localhost:4173). Play locally as a guest, or configure the existing Pocket ID server to test accounts, publishing, sync, and backups. The backup directory must be writable by the container user (UID 1000). See [deployment and restore](docs/deployment.md).

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
