# Aviarium architecture

## Application and game registration

Aviarium ships as one application with one PostgreSQL database. The library, Studio, account/permissions, and game workflows are modules inside that application. Adding a game contributes a browser definition and a server definition, and declares its offline assets.

- Register the browser definition in `apps/web/src/registry.ts`. Aviarium assigns the game its `/games/<id>` route. A game contributes its title, previews, player, Studio editor, and attempt creation. Guide, settings, menu actions, pack presentation, and history are optional. Library and Studio use the same catalog component. Studio starts at the catalog and uses the Studio palette. The game supplies the palette for its own screens.
- Register the server definition in `apps/server/src/games.ts`. It supplies content and save parsers, pack verification, level comparison, optional generated-level resolution, and any game-specific routes. Shared pack routes are under `/api/games/:game/packs` and `/api/games/:game/pack-drafts`. The existing Sudoku pack routes remain available to installed clients.
- Declare the browser entry modules and any separately emitted workers in `apps/web/game-assets.ts`. The build follows their static imports and uses the resulting manifest to install and update the game. The service worker recognizes navigation for registered game IDs.

The shared types, rules for progression, revision assignment, and attempt metadata live in `packages/game-sdk`. A game can supply a different puzzle and board representation. Sudoku keeps its existing flat save and pack fields. New games can store a published level's game-specific payload in the `content` column. Level and pack identifiers are unique across the library. Prefix new built-in and generated IDs with the game ID. Existing Sudoku IDs stay valid.

## Levels and checks

Givens are 81 row-major digits. Zero means empty. A pack draft can be edited without affecting published revisions. The generation job records a seed and generator version. Validation jobs capture the draft revision and return one of invalid, unsolvable, unique, multiple, or inconclusive. The app processes the PostgreSQL job queue after startup. A bounded worker thread runs the solver off the HTTP event loop. The job lease survives browser close and app restart. An expired search budget is inconclusive. Publishing requires verification of the current pack draft. Published data is immutable and the newest revision of each ID forms the shared catalog. Previous revisions remain available for saved attempts. Admins can hide an editor’s publication from the catalog while retaining its saved attempts. Users can play every published game and manage their profile, preferences, and device settings. Editors additionally have Studio access for every game, with ownership checks on pack drafts. Admins also have administration access. Existing game-specific grants are promoted to the Editor role during upgrade.

New Sudoku publications use a deterministic, easiest-first logical solver. Easy uses singles, Medium adds pairs and locked candidates, and Hard adds techniques such as triples and X-Wing. Extreme requires an advanced technique and Genius uses at least three distinct Extreme families in the logical solve. Search is used to verify uniqueness, while grading, hints, and playback use named deductions. An incomplete logical solve needs review. Older puzzle revisions retain their published grades. Quick Play v2 uses verified puzzle pools and seeded grid transformations, and checks that the transformed board keeps its requested grade. Once Sudoku is downloaded, a bundled browser worker creates random or seeded Quick Play puzzles online or offline. The browser keeps the existing seed-derived puzzle ID. On the first sync for an unknown puzzle, the server regenerates its grid from the seed, difficulty and generator version before accepting the save. A shared seed code carries its difficulty and generator version. The installed web app can receive the code through the share sheet on browsers that support share targets.

## Packs and Studio

Open Studio and choose a game to work in **My packs**. Authored levels belong to a pack. The shared workspace provides pack navigation, level ordering, appearance, rule controls, and trail preview. The registered game supplies its presets, rule definitions, level editor, checks, and test player. Pack and level drafts autosave in IndexedDB. After the Studio assets are downloaded, editors can change levels and test-play them within a cached session offline. Sync uses the saved server draft version and keeps local changes available if the server reports a conflict.

Owners manage their packs. Admins use **Administration → Packs → Edit as admin** to enter another creator’s workspace. Server permissions and draft version checks apply to both modes. The package records the last editor and logs admin publications. Publish verifies the exact draft in a server worker and atomically replaces the visible pack revision. Legacy standalone publications appear in recovered packs without changing their existing level or save keys.

A pack revision determines order, rules and presentation. Stable level IDs survive changes in order, and each level has an independent revision. Changes to givens or play rules create a new level revision. Level access lives on the pack. Levels inherit gameplay defaults and may override the controls supplied by the game. Ordered packs preserve access earned on earlier snapshots, count inserted levels toward completion, and allow players to continue from the next new stop. The shared pack trail opens at that next stop and begins above the information card.

Each game registers its built-in packs and bundled artwork lives in `apps/web/public`. Sudoku registers Budgies and Nonograms registers Sulphur-crested Cockatoos. Nonograms also uses the shared Studio with a drawing grid and verifies publication by logical deduction. Admins and a pack’s owner can export published packs as `.aviarium-pack` ZIP archives with a versioned manifest and optional artwork. Import requires editor rights and makes a separate draft with new level identities. Archives carry content and rules.

## Saves and offline storage

Nonograms stores row and column clues as level content with a versioned mark grid and undo history in each attempt. Its Quick Play boards use a seed, size, difficulty, and generator version. The browser generates them offline and the server regenerates them when progress first syncs.

The shared attempt identifies game, level ID and revision, ruleset, and save format. It tracks elapsed time and completion. Sudoku supplies the entries, note masks, and bounded undo/redo. Dexie saves the latest local state and pending upload. Server mutations are idempotent by UUID. A stale base revision creates a separate attempt rather than overwriting the server snapshot. Verified completion is stored independently of individual attempts.

Foreground sync runs when an authenticated player visits the library, returns to the foreground, or reconnects. Active play checkpoints locally until returning to the library or puzzle list. Account identity is checked on authorization-sensitive sync requests. Synced preferences merge field updates. Theme and e-reader mode are device-local. Games use the device's light or dark mode with their own palettes. Sudoku's timer, hints, and conflict highlighting are controlled from the Sudoku menu. The library and catalog endpoint require an account. Saves and the synchronization queue are keyed by account ID.

The production service worker caches the library shell and installs game assets when a game opens. Enable **Manage installs** in **Device settings** to reveal download removal on library cards. Removing a download preserves saves and their versioned puzzle references. Downloads are specific to the browser and are removed after 30 days of inactivity once the server is reachable. While offline, the browser can reopen downloaded games until its last verified session expires. Signing out clears the cached session. API and authentication traffic stay network-only.

## Current scope

The platform ships Sudoku and Nonograms, player accounts and roles, draft review and publishing, local and server progress, and scheduled PostgreSQL backups. It also ships Sudoku packs, seeded Quick Play, and completion history. Daily challenges and high scores are planned. The shared menu accepts optional actions and sections where those features can appear. Scheduling and rankings will belong to Aviarium. Each game will supply challenge content, completion validation, and how to interpret its results.

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
