# Aviarium architecture

## Runtime and code map

Aviarium is an npm-workspaces TypeScript application. Vite builds a React
frontend, and TypeScript compiles the Fastify server and the shared modules.
The production server serves the compiled frontend and API from one origin.
One Aviarium process applies migrations, serves requests, and runs background
loops alongside a separate PostgreSQL service. This keeps deployment to two
services and allows browser requests, session cookies, and PWA routes to share
an origin.

| Area | Start here | When changing it |
| --- | --- | --- |
| Navigation and library | [main.tsx](../apps/web/src/main.tsx), [session.ts](../apps/web/src/session.ts), [api.ts](../apps/web/src/api.ts) | Check direct navigation, refresh, signed-out and offline states. For new paths, check the React route handling, Fastify's HTML fallback, and the service worker navigation list. |
| Sudoku play | [Player.tsx](../apps/web/src/Player.tsx), [Grid.tsx](../apps/web/src/Grid.tsx), [rules.ts](../packages/sudoku/src/rules.ts), [contracts.ts](../packages/sudoku/src/contracts.ts) | Keep the client, server verification, and persisted saves aligned. Exercise touch and keyboard play for input changes. |
| Local and synced progress | [storage.ts](../apps/web/src/storage.ts), [progress.ts](../apps/server/src/progress.ts) | Check account isolation, reconnect and retry, concurrent edits, and old saves. |
| Catalog and creation | [Studio.tsx](../apps/web/src/Studio.tsx), [PackStudio.tsx](../apps/web/src/PackStudio.tsx), [levels.ts](../apps/server/src/levels.ts), [packs.ts](../apps/server/src/packs.ts) | Preserve draft ownership, publication revisions, visibility, and the ability to resume a prior revision. |
| Downloads and updates | [offline.ts](../apps/web/src/offline.ts), [vite.config.ts](../apps/web/vite.config.ts), [sw.txt](../apps/web/sw.txt) | Verify the generated build. Exercise first install, offline reopen, and upgrades when changing cached assets or routing. |
| Authentication and roles | [auth.ts](../apps/server/src/auth.ts), [config.ts](../apps/server/src/config.ts) | Use the existing session and permission helpers. Exercise role changes and account switching. |
| Translation and News | [messages.ts](../apps/web/src/messages.ts), [api-messages.ts](../packages/game-sdk/src/api-messages.ts), [news.ts](../apps/server/src/news.ts), [news-translation.ts](../apps/server/src/news-translation.ts) | Keep English and Dutch messages complete and preserve the shared announcement ID and likes across translations. |
| Startup, jobs, and persistence | [app.ts](../apps/server/src/app.ts), [migrate.ts](../apps/server/src/migrate.ts), [worker.ts](../apps/server/src/worker.ts), [backup-runner.ts](../apps/server/src/backup-runner.ts) | Check readiness, fresh installs and upgrades, and recovery from failed or interrupted work. |

## Design choices and compatibility

- **A shared, versioned puzzle library.** Published puzzle and pack revisions
  are immutable because saved attempts refer to exact versions. Draft edits
  and catalog visibility can change independently of those attempts. Add a
  revision for changed published content, and keep its identity resolvable.
- **One Sudoku engine for play and verification.** The renderer-neutral SDK
  defines common types. Sudoku owns its codecs, rules, and generation. A
  stable ruleset, save format, and generator version let the browser and
  server agree on the meaning of older saves and shared seeds. Check the
  legacy version paths before changing generation or decoding.
- **Offline play with server-verified sync.** The service worker handles assets
  and app navigation. IndexedDB stores gameplay data and pending mutations.
  The API verifies account, puzzle version, and claimed completion when
  accepting a save. Retried mutations return the stored result for the same
  ID and payload. Concurrent edits can create a separate attempt. Keep those
  guarantees when changing either side of synchronization.
- **The server owns permissions.** Pocket ID supplies identity in the normal
  login flow. PostgreSQL stores Aviarium sessions and roles. Use
  `requireUser` or `requireGameEditor` as appropriate and enforce resource
  ownership in the server operation. Write requests must match the configured
  origin. Local-only play and loopback test sessions have distinct behavior.
- **PostgreSQL coordinates durable work.** The puzzle worker claims jobs
  with a lease and runs expensive solving in a bounded worker thread.
  Validation results refer to a draft revision. A publish request must
  still verify the current revision. Backups and optional News translation
  also run inside the app process.
- **Schema upgrades travel with the app.** Startup applies the sorted SQL
  files in [migrations](../apps/server/migrations/) in a transaction under an
  advisory lock. The ledger records filenames. Add a new numbered file for a
  schema or data change and preserve files already applied by deployments.
  Check open PRs for numbering collisions and verify upgrades with existing
  data when the change affects it. Use the existing transaction helper in
  `config.ts` for multi-step writes.
- **Verification and shipping are separate.** [Verify](../.github/workflows/verify.yml)
  tests PRs and `main`. [Publish container](../.github/workflows/container.yml)
  runs on explicit dispatch from `main`, verifies again, versions the image
  from Git tags, and publishes the corresponding release. Use
  [the release instructions](../README.md#publish-a-release) for a release.
  In-app News is a separate, owner-requested change.

## Game registration

The web registry in `apps/web/src/registry.ts` exposes lightweight metadata and a lazy player loader. Sudoku ruleset 1 is used by the player, API completion verification, and the server puzzle worker. The current API and PWA routes are explicitly bound to Sudoku. When a second game is approved, add its registered ruleset, content codecs, optional creator tools, route, and asset graph alongside Sudoku. A game supplies its own validation semantics and rendering technology.

## Levels and checks

Givens are 81 row-major digits. Zero means empty. A draft can be edited without affecting published revisions. The generation job records a seed and generator version. Validation jobs capture the draft revision and return one of invalid, unsolvable, unique, multiple, or inconclusive. The app processes the PostgreSQL job queue after startup. A bounded worker thread runs the solver off the HTTP event loop. The job lease survives browser close and app restart. An expired search budget is inconclusive. Publishing requires a successful test of the current draft. Published data is immutable and the newest revision of each ID forms the shared catalog. Previous revisions remain available for saved attempts. Admins can hide an editor’s publication from the catalog while retaining its saved attempts. Users can play every published game. Editing access is granted by game ID and checked by the server. Admins have editing access across the library.

New Sudoku publications use a deterministic, easiest-first logical solver. Easy uses singles, Medium adds pairs and locked candidates, and Hard adds techniques such as triples and X-Wing. Extreme requires an advanced technique and Genius uses at least three distinct Extreme families in the logical solve. Search is used to verify uniqueness, while grading, hints, and playback use named deductions. An incomplete logical solve needs review. Older puzzle revisions retain their published grades. Quick Play v2 uses verified puzzle pools and seeded grid transformations, and checks that the transformed board keeps its requested grade. Once Sudoku is downloaded, a bundled browser worker creates random or seeded Quick Play puzzles online or offline. The browser keeps the existing seed-derived puzzle ID. On the first sync for an unknown puzzle, the server regenerates its grid from the seed, difficulty and generator version before accepting the save. A shared seed code carries its difficulty and generator version. The installed web app can receive the code through the share sheet on browsers that support share targets.

## Packs

The default packs live in `packages/sudoku/src/built-in-packs.ts`. Artwork files go in `apps/web/public`. Add a new revision when changing a published pack so existing saves can still open it. Editors can create, import, reorder, theme, publish, and hide their own packs in **Studio → Packs**. PostgreSQL stores editable drafts and immutable published revisions. Every stop has a separate puzzle identity, so ordinary play or another pack cannot unlock it. The shared `PackTrail` component is the default pack layout. Stops climb from the bottom of the trail, with pack information just below the start. Opening a pack brings the next stop into view. Each game supplies the stop labels, progress state, and action while keeping its own unlock and play rules.

Admins and the editor who owns a pack can export it. Exported `.aviarium-pack` files are ZIP archives with a versioned `manifest.json`, ordered grids, challenge rules, and optional cover and background images. An editor can import one on another install, where the server checks the format, uniqueness, and logical grading before creating a draft. The archive is limited to content, so it carries no accounts or progress. The Sudoku engine and archive library notices are shipped in `sudoku-licenses.txt`.

## Saves and offline storage

The Sudoku save envelope identifies game, level ID and revision, ruleset, and save format. It includes entries, note masks, bounded undo/redo, elapsed time, and completion. Dexie saves the latest local state and pending upload. Server mutations are idempotent by UUID. A stale base revision creates a separate attempt rather than overwriting the server snapshot. Verified completion is stored independently of individual attempts.

Foreground sync runs when an authenticated player visits the library, returns to the foreground, or reconnects. Active play checkpoints locally until returning to the library or puzzle list. Account identity is checked on authorization-sensitive sync requests. Synced preferences merge field updates. Theme and e-reader mode are device-local. Games use the device's light or dark mode with their own palettes. Sudoku's timer, hints, and conflict highlighting are controlled from the Sudoku menu. The library and catalog endpoint require an account. Saves and the synchronization queue are keyed by account ID.

The production service worker caches the library shell and installs game assets when a game opens. Enable **Manage installs** in **Device settings** to reveal download removal on library cards. Removing a download preserves saves and their versioned puzzle references. Downloads are specific to the browser and are removed after 30 days of inactivity once the server is reachable. While offline, the browser can reopen downloaded games until its last verified session expires. Signing out clears the cached session. API and authentication traffic stay network-only.

## Current scope

The platform ships Sudoku, player accounts and roles, draft review and publishing, local and server progress, and scheduled PostgreSQL backups. It also ships Sudoku packs, seeded Quick Play, and completion history. Personal or competitive ranking, daily schedules, and other games require their own milestones.

## Release announcements

Create a release announcement only when the owner explicitly requests one. When requested, bundle it in a new SQL migration. Add one News post for the live environment and one for the test environment, using the release's public version and date. The first startup on an updated server applies the migration once, so the announcement appears automatically and existing local posts and likes stay in place.

## Localization

React Intl loads the selected English or Dutch catalog from the offline shell.
Language is an account preference that syncs through the existing preferences
API. The browser caches it for offline use and remembers the last known list
of enabled locales. Built-in Sudoku content uses stable puzzle IDs for translated text.
Creator-authored text is displayed as entered.

Official announcements store both language versions under one news ID.
Fastify validates both versions and writes them in one transaction. The feed
returns the requested enabled locale or an available version for legacy posts.
Admins can queue AI drafts from either language using the PostgreSQL-backed
translation worker. Draft results are editable and publication requires an
explicit admin action.
