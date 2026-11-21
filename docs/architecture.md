# Aviarium architecture

## Game registration

The web registry in `apps/web/src/registry.ts` exposes lightweight metadata and a lazy player loader. Sudoku ruleset 1 is used by the player, API completion verification, and the server puzzle worker. The current API and PWA routes are explicitly bound to Sudoku. When a second game is approved, add its registered ruleset, content codecs, optional creator tools, route, and asset graph alongside Sudoku. A game supplies its own validation semantics and rendering technology.

## Levels and checks

Givens are 81 row-major digits. Zero means empty. A draft can be edited without affecting published revisions. The generation job records a seed and generator version. Validation jobs capture the draft revision and return one of invalid, unsolvable, unique, multiple, or inconclusive. The app processes the PostgreSQL job queue after startup. A bounded worker thread runs the solver off the HTTP event loop. The job lease survives browser close and app restart. An expired search budget is inconclusive. Publishing requires a successful test of the current draft. Published data is immutable and the newest revision of each ID forms the shared catalog. Previous revisions remain available for saved attempts. Admins can hide an editor’s publication from the catalog while retaining its saved attempts. Users can play every published game. Editing access is granted by game ID and checked by the server. Admins have editing access across the library.

New Sudoku publications use a deterministic, easiest-first logical solver. Easy uses singles, Medium adds pairs and locked candidates, and Hard adds techniques such as triples and X-Wing. Extreme requires an advanced technique and Genius uses at least three distinct Extreme families in the logical solve. Search is used to verify uniqueness, while grading, hints, and playback use named deductions. An incomplete logical solve needs review. Older puzzle revisions retain their published grades. Quick Play v2 uses verified puzzle pools and seeded grid transformations, and checks that the transformed board keeps its requested grade. The browser can resume cached puzzles offline, and starting a new Quick Play puzzle uses the server. A shared seed code carries its difficulty and generator version. The installed web app can receive the code through the share sheet on browsers that support share targets.

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
