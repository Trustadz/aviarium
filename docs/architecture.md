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
| Navigation and library | [main.tsx](../apps/web/src/main.tsx), [GameCatalog.tsx](../apps/web/src/GameCatalog.tsx), [registry.ts](../apps/web/src/registry.ts) | Check direct navigation, refresh, signed-out and offline states. Check route handling in React, Fastify's HTML fallback, and the service worker. |
| Sudoku play | [Player.tsx](../apps/web/src/Player.tsx), [Grid.tsx](../apps/web/src/Grid.tsx), [rules.ts](../packages/sudoku/src/rules.ts), [contracts.ts](../packages/sudoku/src/contracts.ts) | Keep the client, server verification, and persisted saves aligned. Exercise touch and keyboard play for input changes. |
| Nonograms play | [Nonograms.tsx](../apps/web/src/Nonograms.tsx), [puzzles.ts](../packages/nonograms/src/puzzles.ts), [nonograms-game.ts](../apps/server/src/nonograms-game.ts) | Keep clue validation, saved marks, and seeded Quick Play aligned across the browser and server. |
| Local and synced progress | [storage.ts](../apps/web/src/storage.ts), [progress.ts](../apps/server/src/progress.ts) | Check account isolation, reconnect and retry, concurrent edits, and old saves. |
| Leaderboards | [leaderboards.ts](../apps/server/src/leaderboards.ts), [Leaderboards.tsx](../apps/web/src/Leaderboards.tsx), [leaderboards.ts](../packages/game-sdk/src/leaderboards.ts) | Check board grouping, the per-exact-puzzle cooldown, tie ranks, moderation notices, and that a completion still syncs when its result is suppressed. |
| Catalog and creation | [PackStudio.tsx](../apps/web/src/PackStudio.tsx), [SudokuStudio.tsx](../apps/web/src/SudokuStudio.tsx), [NonogramsStudio.tsx](../apps/web/src/NonogramsStudio.tsx), [packs.ts](../apps/server/src/packs.ts) | Preserve draft ownership, offline edits, publication revisions, visibility, and the ability to resume a prior revision. |
| Downloads and updates | [offline.ts](../apps/web/src/offline.ts), [game-assets.ts](../apps/web/game-assets.ts), [vite.config.ts](../apps/web/vite.config.ts), [sw.txt](../apps/web/sw.txt) | Verify the generated build. Exercise first install, offline reopen, and upgrades when changing cached assets or routing. |
| Authentication and roles | [auth.ts](../apps/server/src/auth.ts), [config.ts](../apps/server/src/config.ts) | Use the existing session and permission helpers. Exercise role changes and account switching. |
| Translation and News | [messages.ts](../apps/web/src/messages.ts), [api-messages.ts](../packages/game-sdk/src/api-messages.ts), [news.ts](../apps/server/src/news.ts), [news-translation.ts](../apps/server/src/news-translation.ts) | Keep English and Dutch messages complete and preserve the shared announcement ID and likes across translations. |
| Startup, jobs, and persistence | [app.ts](../apps/server/src/app.ts), [migrate.ts](../apps/server/src/migrate.ts), [worker.ts](../apps/server/src/worker.ts), [backup-runner.ts](../apps/server/src/backup-runner.ts) | Check readiness, fresh installs and upgrades, and recovery from failed or interrupted work. |

## Design choices and compatibility

- **A shared, versioned puzzle library.** Published puzzle and pack revisions
  are immutable because saved attempts refer to exact level versions. Pack
  revisions track changes to the published pack. Level revisions advance
  independently when a level's puzzle or effective gameplay rules change.
  Draft edits and catalog visibility can change independently of saved
  attempts. Keep the referenced level revisions available.
- **Back follows the visible screen hierarchy.** Gameplay, Studio pack
  editing, and Studio test play are history layers. Browser, hardware, and
  in-app back move a game to its level selector (or game menu), a selector to
  the game menu, a game menu to the library, test play to the pack editor,
  the pack editor to **My packs**, and My packs to Studio or to the game menu
  it was opened from. In-app back actions pop the current layer
  rather than pushing a duplicate. Opening a game from a shortcut such as
  Continue, History, or a shared puzzle lays down the missing menu and
  level-selector layers first. A directly opened deep link is seeded with its
  parent layers so back stays inside the app. Keep this hierarchy when adding
  screens that sit under a game or Studio.
- **Game play fits the viewport.** The Sudoku and Nonograms play screens fill
  the dynamic viewport and size their boards from the space left by the header
  and controls, so the board, inputs, tools, and result actions stay visible
  without page scrolling from phone portrait through ultrawide desktop. Short
  viewports compact the heading and controls, and Nonograms derive their cell
  size from both available dimensions. Menus, catalogs, and long lists may
  still scroll because their content is not a fixed play surface. A new game
  should follow the same rule or explain why its play surface needs to scroll.
- **Shared game contracts with game-specific logic.** The renderer-neutral SDK
  defines common types. Each game owns its codecs, rules, and generation. A
  stable ruleset, save format, and generator version let the browser and
  server agree on the meaning of older saves and shared seeds. Check the
  legacy version paths before changing generation or decoding.
- **Offline play with server-verified sync.** The service worker handles assets
  and app navigation. IndexedDB stores gameplay data and pending mutations.
  The API verifies account, puzzle version, and claimed completion when
  accepting a save. Retried mutations return the stored result for the same
  ID and payload. Concurrent edits can create a separate attempt. Keep those
  guarantees when changing either side of synchronization.
- **Leaderboards record every completed sync.** A verified completion writes its
  result in the same transaction as its completion record. Boards group results
  by the game's settings: Sudoku Quick Play by difficulty, Nonograms random
  boards by size and difficulty, and pack or fixed levels by level revision.
  The exact starting grid or clue set is hashed for a 30-day per-puzzle
  cooldown; a repeat inside that window is stored as `cooldown` and hidden,
  while a different puzzle posts immediately. Standings show the best active
  result per player, equal times share a rank, and history remains for
  moderation. Quick Play results keep the exact level and seed code so another
  player can open the same board. Admins remove a result with a reason; the next
  active time appears, the completion and cooldown stay, and the owner
  acknowledges a once-only notice. There is no opt-in and no per-seed board.
  Each game declares its boards and result interpretation through the shared
  leaderboard registration point; Sudoku and Nonograms implement it. New tables
  only: no historical completions are backfilled, and suppressed results never
  remove the completion.
  The web leaderboard keeps the player in view: the catalog and game hub lead
  with the signed-in player's latest active posting (`recorded_at`, not their
  best) and best current rank (lowest rank, then more players, then recency),
  scoped globally and per game. Board pages show a `Your best` strip, the top
  ten with a `Show 20` reveal, tie rails, a highlighted viewer row, and avatars
  for the podium and viewer through the authenticated
  `/api/users/:id/avatar` endpoint; other rows use initials. Quick Play rows
  expose a copyable seed chip and an exact-board play action, while level
  boards omit the Board column. The admin panel filters by game and status and
  keeps removed results collapsed. Test deployments may backdate a posting
  with the test-only `seedRecordedAt` mutation field for the API-driven mock
  seeder; production ignores it.
  On phones the hub and board keep their back/copy bar sticky, the board table
  collapses to rank, player and time with a 44px Play action and no seed chip,
  `Your play` stays two-up down to 360px, Quick Play is two-up down to 360px,
  and the admin table reveals results twenty at a time. Long removal reasons
  scroll inside the dialog, and 200% text must not introduce horizontal page
  overflow.
  Standings also expose an **All records** view that pages through every
  active result, including multiple results from one player, without the
  best-per-player cap. Pack cards aggregate entire packs: a player's total is
  the sum of their best active time on every level, ranked only when every
  level is present, with avatars in the pack table, mini top-three lists, and
  each level's best row. On phones the profile sits in the upper-right header
  so the remaining bottom destinations keep their labels. Studio is not a
  destination: editors reach it from the library heading or a game menu.
- **The server owns permissions.** Pocket ID supplies identity in the normal
  login flow. PostgreSQL stores Aviarium sessions and roles. Use
  `requireUser` or `requireEditor` as appropriate and enforce resource
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

## Application and game registration

The library, Studio, account permissions, and game workflows are modules inside
the application. Adding a game contributes a browser definition and a server
definition, and declares its offline assets. Sudoku and Nonograms both use
these registration points.

- Register the [browser definition](../apps/web/src/game-web.ts) in [registry.ts](../apps/web/src/registry.ts). Aviarium assigns the game its `/games/<id>` route. A game contributes its title, previews, player, Studio editor, and attempt creation. Guide, settings, menu actions, pack presentation, history, and the leaderboard link are optional. Library and Studio use the same catalog component. Studio starts at the catalog and uses the Studio palette. The game supplies the palette for its own screens and implements the [Studio contract](../apps/web/src/game-studio.ts).
- Register the [server definition](../apps/server/src/game-runtime.ts) in [games.ts](../apps/server/src/games.ts). It supplies content and save parsers, pack verification, level comparison, optional generated-level resolution, optional leaderboard board grouping and result interpretation, and any game-specific routes. Shared pack routes are under `/api/games/:game/packs` and `/api/games/:game/pack-drafts`. The existing Sudoku pack routes remain available to installed clients.
- Declare the browser entry modules and any separately emitted workers in [game-assets.ts](../apps/web/game-assets.ts). The build follows the entries' static imports and includes the declared workers. The service worker uses the manifest to install and update assets and to recognize navigation for registered game IDs.

The shared types, rules for progression, revision assignment, and attempt metadata live in `packages/game-sdk`. A game can supply a different puzzle and board representation. Sudoku keeps its existing flat save and pack fields. New games can store a published level's game-specific payload in the `content` column. Level and pack identifiers are unique across the library. Prefix new built-in and generated IDs with the game ID. Existing Sudoku IDs stay valid.

## Levels and checks

Givens are 81 row-major digits. Zero means empty. A pack draft can be edited without affecting published revisions. The generation job records a seed and generator version. Validation jobs capture the draft revision and return one of invalid, unsolvable, unique, multiple, or inconclusive. The app processes the PostgreSQL job queue after startup. A bounded worker thread runs the solver off the HTTP event loop. The job lease survives browser close and app restart. An expired search budget is inconclusive. Publishing requires verification of the current pack draft. Published data is immutable and the newest revision of each ID forms the shared catalog. Previous revisions remain available for saved attempts. Admins can hide an editor’s publication from the catalog while retaining its saved attempts. Users can play every published game and manage their profile, preferences, and device settings. Editors additionally have Studio access for every game, with ownership checks on pack drafts. Admins also have administration access. Existing game-specific grants are promoted to the Editor role during upgrade.

New Sudoku publications use a deterministic, easiest-first logical solver. Easy uses singles, Medium adds pairs and locked candidates, and Hard adds techniques such as triples and X-Wing. Extreme requires an advanced technique and Genius uses at least three distinct Extreme families in the logical solve. Search is used to verify uniqueness, while grading, hints, and playback use named deductions. An incomplete logical solve needs review. Older puzzle revisions retain their published grades. Quick Play v2 uses verified puzzle pools and seeded grid transformations, and checks that the transformed board keeps its requested grade. Once Sudoku is downloaded, a bundled browser worker creates random or seeded Quick Play puzzles online or offline. The browser keeps the existing seed-derived puzzle ID. On the first sync for an unknown puzzle, the server regenerates its grid from the seed, difficulty and generator version before accepting the save. A shared seed code carries its difficulty and generator version. The installed web app can receive the code through the share sheet on browsers that support share targets.

## Packs and Studio

Open Studio from the library heading (editors and admins only) or from a game menu, choose a game, then work in **My packs**. Authored levels belong to a pack. The shared workspace provides pack navigation, level ordering, appearance, rule controls, and trail preview. The registered game supplies its presets, rule definitions, level editor, checks, and test player. Pack and level drafts autosave in IndexedDB. After the Studio assets are downloaded, editors can change levels and test-play them within a cached session offline. Sync uses the saved server draft version and keeps local changes available if the server reports a conflict.

Owners manage their packs. Admins use **Administration → Packs → Edit as admin** to enter another creator’s workspace. Server permissions and draft version checks apply to both modes. The package records the last editor and logs admin publications. Publish verifies the exact draft in a server worker and atomically replaces the visible pack revision. Legacy standalone publications appear in recovered packs without changing their existing level or save keys.

A pack revision determines order, rules and presentation. Stable level IDs survive changes in order, and each level has an independent revision. Changes to givens or play rules create a new level revision. Level access lives on the pack. Levels inherit gameplay defaults and may override the controls supplied by the game. Ordered packs preserve access earned on earlier snapshots, count inserted levels toward completion, and allow players to continue from the next new stop. The shared pack trail opens at that next stop and begins above the information card.

Each game registers its built-in packs and bundled artwork lives in `apps/web/public`. Sudoku registers Budgies and Nonograms registers Sulphur-crested Cockatoos. Nonograms also uses the shared Studio with a drawing grid and verifies publication by logical deduction. Admins and a pack’s owner can export published packs as `.aviarium-pack` ZIP archives with a versioned manifest and optional artwork. Import requires editor rights and makes a separate draft with new level identities. Archives carry content and rules.

## Saves and offline storage

Nonograms stores row and column clues as level content with a versioned mark grid and undo history in each attempt. Its Quick Play boards use a seed, size, difficulty, and generator version. The browser generates them offline and the server regenerates them when progress first syncs.

The shared attempt identifies game, level ID and revision, ruleset, and save format. It tracks elapsed time and completion. Sudoku supplies the entries, note masks, and bounded undo/redo. Dexie saves the latest local state and pending upload. Server mutations are idempotent by UUID. A stale base revision creates a separate attempt rather than overwriting the server snapshot. Verified completion is stored independently of individual attempts.

Foreground sync runs when an authenticated player visits the library, returns to the foreground, or reconnects. Active play checkpoints locally until returning to the library or puzzle list. Account identity is checked on authorization-sensitive sync requests. Synced preferences merge field updates. Theme and e-reader mode are device-local. Games use the device's light or dark mode with their own palettes. Sudoku's timer, hints, and conflict highlighting are controlled from the Sudoku menu. The library and catalog endpoint require an account. Saves and the synchronization queue are keyed by account ID.

The production service worker caches the library shell and installs game assets when a game opens. Enable **Manage installs** in **Device settings** to reveal download removal on library cards. Removing a download preserves saves and their versioned puzzle references. Downloads are specific to the browser and are removed after 30 days of inactivity once the server is reachable. While offline, the browser can reopen downloaded games until its last verified session expires. Signing out clears the cached session. API and authentication traffic stay network-only.

## Daily challenges

Daily challenges are a platform-owned scheduled drop. Aviarium stores the
series, occurrence, slot, attempt and challenge-result grains; generates and
persists the exact level once; claims one attempt per player per game; closes the
challenge board at the next reset; and exposes the current day, a closed day and
a seed replay. A game supplies its normal generation, attempt validation and
result interpretation; it does not implement scheduling, boards, attempts or
challenge UI. Challenge-capable games are derived from the shared `GameRegistry`: a
`GameDefinition` with `generation` and `leaderboard` is automatically eligible,
and its `challenge.optionGroups` drive the admin and scheduler. The current release uses each game's default rules; Sudoku and Nonograms are
eligible, X can be 1 or 2, and each enabled game contributes at most one slot.
Pack-rule variants are a future option-group extension.

Occurrence boundaries use an instance-wide IANA timezone from
`CHALLENGE_TIMEZONE` (default UTC) and an admin reset minute. Spring-forward gap
times resolve to the first valid instant after the gap; fall-back repeats use
the earlier instant. A day with less than two hours remaining is not created.
The daily board closes at `ends_at`; a late completion is saved but not posted.
The closed day exposes a replay seed, which launches a normal generated game and
posts to the general board, not the closed daily board. Challenge levels use
`source='Challenge'`, `catalog_visible=false`, and are rejected by normal
progress mutations. Challenge results use `board_kind='challenge'` and
`board_key='challenge:<slotId>'` and are excluded from general cooldowns,
player summaries and board selection. The pure boundary helper is
[`challenges/time.ts`](../apps/server/src/challenges/time.ts); the API and
product rules are documented in [daily challenges](challenges.md).
## Game contract

The shared game contract is documented in [game contract](game-contract.md). A
game supplies its level/attempt codecs, generation, pack materialization and
result interpretation; the platform owns routing, packs, leaderboards, saves and
daily challenges. The Sudoku and Nonograms `GameDefinition` adapters, the runtime
registry and a fake-game fixture are in place. The server compatibility map is
built from the definitions and injected into the platform registrations. Daily
challenges now derive their registry from the same definitions, so a new game
with `generation` and `leaderboard` is eligible without a challenge adapter. Game
modules no longer own routes: generic `/api/games/:game/quick-play` and
`/api/games/:game/levels/:id/:revision` live in `game-routes.ts`, and the old
Sudoku routes are quarantined. The legacy `ServerGame` adapter and the web
contract remain for J4b/J5.

## Current scope

The platform ships Sudoku and Nonograms, player accounts and roles, draft review and publishing, local and server progress, completion history, leaderboards, and scheduled PostgreSQL backups. It also ships Sudoku packs and seeded Quick Play. Every completed game with a leaderboard declaration posts a result; Sudoku and Nonograms group their boards by difficulty, size, or level revision. Daily challenges use the platform-owned scheduling and ranking model described above; Sudoku and Nonograms are eligible, X is configured by an admin (1–2), and the feature is disabled until enabled.

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
